import * as vscode from 'vscode';
import * as path from 'path'; // ← 先頭付近になければ追加
import { FolderBookmarkProvider, BookmarkDragAndDropController,FsItem, BookmarkEntry, pickColor } from './projectProvider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new FolderBookmarkProvider(context.globalStorageUri.fsPath);

  const treeView = vscode.window.createTreeView('folderBookmarksView', {
    treeDataProvider: provider,
    showCollapseAll: true,
    dragAndDropController: new BookmarkDragAndDropController(provider), // ← この1行を追加！
  });

  // 共通の登録ロジック
  const registerBookmark = async (targetPath: string) => {
    const config = vscode.workspace.getConfiguration('folderBookmarks');
    const bookmarks: BookmarkEntry[] = config.get('bookmarks') ?? [];
    if (bookmarks.some(b => b.path === targetPath)) return;

    await config.update(
      'bookmarks',
      [...bookmarks, { path: targetPath, color: '#eab308' }],
      vscode.ConfigurationTarget.Global
    );
    provider.refresh();
  };

  // 1. フォルダを追加（アイコン：新規フォルダ）
  const addBookmark = vscode.commands.registerCommand(
    'folder-bookmarks.add',
    async (uri?: vscode.Uri) => {
      if (uri?.fsPath) {
        await registerBookmark(uri.fsPath);
        return;
      }
      const uris = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'フォルダをブックマーク',
      });
      if (uris?.[0]?.fsPath) {
        await registerBookmark(uris[0].fsPath);
      }
    }
  );

  // 2. ファイルを追加（アイコン：新規ファイル）
  const addFileBookmark = vscode.commands.registerCommand(
    'folder-bookmarks.addFile',
    async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectFolders: false,
        canSelectFiles: true,
        canSelectMany: false,
        openLabel: 'ファイルをブックマーク',
      });
      if (uris?.[0]?.fsPath) {
        await registerBookmark(uris[0].fsPath);
      }
    }
  );

  // ブックマークから削除
  const removeBookmark = vscode.commands.registerCommand(
    'folder-bookmarks.remove',
    async (item?: FsItem) => {
      const target = item ?? treeView.selection[0];
      if (!target?.fsPath) return;

      const config = vscode.workspace.getConfiguration('folderBookmarks');
      const bookmarks: BookmarkEntry[] = config.get('bookmarks') ?? [];

      const targetNormalized = path.resolve(target.fsPath);

      // 完全一致、または選択中の要素がそのブックマーク配下にある場合にヒットさせる
      const indexToRemove = bookmarks.findIndex(b => {
        const bNormalized = path.resolve(b.path);
        return (
          bNormalized === targetNormalized ||
          targetNormalized.startsWith(bNormalized + path.sep)
        );
      });

      if (indexToRemove === -1) return;

      // 対象のブックマークを削除
      bookmarks.splice(indexToRemove, 1);

      await config.update(
        'bookmarks',
        bookmarks,
        vscode.ConfigurationTarget.Global
      );
      provider.refresh();
    }
  );

  // 色を変更
  const changeColor = vscode.commands.registerCommand(
    'folder-bookmarks.changeColor',
    async (item: FsItem) => {
      if (!item?.fsPath) return;
      const hex = await pickColor();
      if (!hex) return;

      const config = vscode.workspace.getConfiguration('folderBookmarks');
      const bookmarks: BookmarkEntry[] = config.get('bookmarks') ?? [];
      const updated = bookmarks.map(b =>
        b.path === item.fsPath ? { ...b, color: hex } : b
      );
      await config.update('bookmarks', updated, vscode.ConfigurationTarget.Global);
      provider.refresh();
    }
  );

  // 更新
  const refresh = vscode.commands.registerCommand(
    'folder-bookmarks.refresh',
    () => provider.refresh()
  );

  // Finderで表示
  const revealInFinder = vscode.commands.registerCommand(
    'folder-bookmarks.revealInFinder',
    (item: FsItem) => {
      if (!item?.fsPath) return;
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(item.fsPath));
    }
  );

  // 設定変更時に自動更新
  const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('folderBookmarks')) {
      provider.refresh();
    }
  });

  context.subscriptions.push(
    treeView,
    addBookmark,
    removeBookmark,
    changeColor,
    refresh,
    revealInFinder,
    configWatcher,
    addFileBookmark
  );
}

export function deactivate() {}
