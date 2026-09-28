import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export type ItemType = 'bookmark' | 'folder' | 'file';

export interface BookmarkEntry {
  path: string;
  color: string;
}

const DEFAULT_COLOR = '#eab308'; // 黄色

const COLOR_OPTIONS: { label: string; hex: string }[] = [
  { label: '黄色',    hex: '#eab308' },
  { label: '緑',      hex: '#22c55e' },
  { label: '青',      hex: '#3b82f6' },
  { label: '赤',      hex: '#ef4444' },
  { label: 'オレンジ', hex: '#f97316' },
  { label: '紫',      hex: '#a855f7' },
  { label: 'ピンク',  hex: '#ec4899' },
  { label: 'グレー',  hex: '#9ca3af' },
];

/**
 * hex カラーからフラットな円 SVG を生成してファイルに保存し、Uri を返す
 */
function ensureColorIcon(storagePath: string, hex: string): { light: vscode.Uri; dark: vscode.Uri } {
  const safeName = hex.replace('#', '');
  const filePath = path.join(storagePath, `dot_${safeName}.svg`);
  if (!fs.existsSync(filePath)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" fill="${hex}"/></svg>`;
    fs.writeFileSync(filePath, svg, 'utf8');
  }
  const uri = vscode.Uri.file(filePath);
  return { light: uri, dark: uri };
}

export async function pickColor(): Promise<string | undefined> {
  const picked = await vscode.window.showQuickPick(
    COLOR_OPTIONS.map(c => ({ label: c.label, description: c.hex, hex: c.hex })),
    { placeHolder: '色を選んでください' }
  );
  return picked?.hex;
}

export class FsItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly fsPath: string,
    public readonly itemType: ItemType,
    collapsibleState: vscode.TreeItemCollapsibleState,
    iconOverride?: { light: vscode.Uri; dark: vscode.Uri }
  ) {
    super(label, collapsibleState);
    this.tooltip = fsPath;

    if (itemType === 'file') {
      this.contextValue = 'file';
      this.resourceUri = vscode.Uri.file(fsPath);
      this.iconPath = vscode.ThemeIcon.File;
      this.command = {
        command: 'vscode.open',
        title: 'ファイルを開く',
        arguments: [vscode.Uri.file(fsPath)],
      };
    } else if (itemType === 'bookmark') {
      this.contextValue = 'bookmark';
      this.resourceUri = vscode.Uri.file(fsPath);
      this.iconPath = iconOverride ?? vscode.ThemeIcon.Folder;
    } else {
      // folder（ブックマーク配下のサブフォルダ）
      this.contextValue = 'folder';
      this.resourceUri = vscode.Uri.file(fsPath);
      this.iconPath = vscode.ThemeIcon.Folder;
    }
  }
}

export class FolderBookmarkProvider implements vscode.TreeDataProvider<FsItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<FsItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly storagePath: string) {
    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true });
    }
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: FsItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: FsItem): FsItem[] {
    // フォルダ展開
    if (element) {
      return this.readDir(element.fsPath);
    }
    // ルート → ブックマーク一覧
    return this.getBookmarks();
  }

  private getBookmarks(): FsItem[] {
    const config = vscode.workspace.getConfiguration('folderBookmarks');
    const bookmarks: BookmarkEntry[] = config.get('bookmarks') ?? [];
    return bookmarks
      .filter(b => fs.existsSync(b.path))
      .map(b => {
        const isFile = fs.statSync(b.path).isFile();
        if (isFile) {
          // 単体ファイルの場合：展開不可（None）で作成
          return new FsItem(
            path.basename(b.path),
            b.path,
            'file',
            vscode.TreeItemCollapsibleState.None
          );
        }

        // 従来通りのフォルダの場合
        const icon = ensureColorIcon(this.storagePath, b.color ?? DEFAULT_COLOR);
        return new FsItem(
          path.basename(b.path),
          b.path,
          'bookmark',
          vscode.TreeItemCollapsibleState.Collapsed,
          icon
        );
      });
  }

  private readDir(dirPath: string): FsItem[] {
    if (!fs.existsSync(dirPath)) return [];
    const entries = fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter(d => !d.name.startsWith('.'));

    const dirs = entries
      .filter(d => d.isDirectory())
      .map(d => new FsItem(d.name, path.join(dirPath, d.name), 'folder', vscode.TreeItemCollapsibleState.Collapsed));

    const files = entries
      .filter(d => d.isFile())
      .map(d => new FsItem(d.name, path.join(dirPath, d.name), 'file', vscode.TreeItemCollapsibleState.None));

    return [...dirs, ...files];
  }
}


export class BookmarkDragAndDropController implements vscode.TreeDragAndDropController<FsItem> {
  // ① 受け入れるMIMEタイプに 'text/uri-list'（タブや外部ファイルのドラッグ）を追加
  dropMimeTypes = [
    'application/vnd.code.tree.folderBookmarksView',
    'text/uri-list'
  ];
  dragMimeTypes = ['application/vnd.code.tree.folderBookmarksView'];

  constructor(private readonly provider: FolderBookmarkProvider) {}

  handleDrag(source: readonly FsItem[], treeDataTransfer: vscode.DataTransfer): void {
    if (source.length > 0) {
      treeDataTransfer.set(
        'application/vnd.code.tree.folderBookmarksView',
        new vscode.DataTransferItem(source[0])
      );
    }
  }

  async handleDrop(target: FsItem | undefined, sources: vscode.DataTransfer): Promise<void> {
    const config = vscode.workspace.getConfiguration('folderBookmarks');
    let bookmarks: BookmarkEntry[] = config.get('bookmarks') ?? [];

    // -------------------------------------------------------------
    // パターン1：ツリー内部での並び替えドロップの場合（最優先で判定）
    // -------------------------------------------------------------
    const transferItem = sources.get('application/vnd.code.tree.folderBookmarksView');
    if (transferItem) {
      const sourceItem = transferItem.value as FsItem;
      if (sourceItem && (sourceItem.itemType === 'bookmark' || sourceItem.itemType === 'file')) {
        const sourceIndex = bookmarks.findIndex(b => b.path === sourceItem.fsPath);
        if (sourceIndex !== -1) {
          const [movedItem] = bookmarks.splice(sourceIndex, 1);

          if (target && (target.itemType === 'bookmark' || target.itemType === 'file')) {
            const targetIndex = bookmarks.findIndex(b => b.path === target.fsPath);
            if (targetIndex !== -1) {
              bookmarks.splice(targetIndex, 0, movedItem);
            } else {
              bookmarks.push(movedItem);
            }
          } else {
            bookmarks.push(movedItem);
          }

          await config.update('bookmarks', bookmarks, vscode.ConfigurationTarget.Global);
          this.provider.refresh();
          return; // ← 並び替えが完了したらここで終了
        }
      }
    }

    // -------------------------------------------------------------
    // パターン2：エディタのタブや外部からのドロップ（新規追加）
    // -------------------------------------------------------------
    const uriListItem = sources.get('text/uri-list');
    if (uriListItem) {
      const uriListString = await uriListItem.asString();
      const uris = uriListString
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));

      let added = false;
      for (const uriStr of uris) {
        try {
          const uri = vscode.Uri.parse(uriStr);
          const filePath = uri.fsPath;
          if (filePath && fs.existsSync(filePath)) {
            if (!bookmarks.some(b => b.path === filePath)) {
              bookmarks.push({ path: filePath, color: '#eab308' });
              added = true;
            }
          }
        } catch (e) {
          console.error('Failed to parse dropped URI:', e);
        }
      }

      if (added) {
        await config.update('bookmarks', bookmarks, vscode.ConfigurationTarget.Global);
        this.provider.refresh();
      }
    }
  }
}
