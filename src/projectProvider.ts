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
