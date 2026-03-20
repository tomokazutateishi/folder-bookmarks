import * as vscode from 'vscode';
import { FolderBookmarkProvider, FsItem, BookmarkEntry, pickColor } from './projectProvider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new FolderBookmarkProvider(context.globalStorageUri.fsPath);

  const treeView = vscode.window.createTreeView('folderBookmarksView', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  // フォルダを追加（タイトルバーボタン or 右クリック）
  const addBookmark = vscode.commands.registerCommand(
    'folder-bookmarks.add',
    async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'ブックマークに追加',
      });
      const folderPath = uris?.[0]?.fsPath;
      if (!folderPath) return;

      const config = vscode.workspace.getConfiguration('folderBookmarks');
      const bookmarks: BookmarkEntry[] = config.get('bookmarks') ?? [];
      if (bookmarks.some(b => b.path === folderPath)) return;

      await config.update(
        'bookmarks',
        [...bookmarks, { path: folderPath, color: '#eab308' }],
        vscode.ConfigurationTarget.Global
      );
      provider.refresh();
    }
  );

  // ブックマークから削除
  const removeBookmark = vscode.commands.registerCommand(
    'folder-bookmarks.remove',
    async (item?: FsItem) => {
      const target = item ?? treeView.selection[0];
      if (!target?.fsPath || target.itemType !== 'bookmark') return;
      const config = vscode.workspace.getConfiguration('folderBookmarks');
      const bookmarks: BookmarkEntry[] = config.get('bookmarks') ?? [];
      await config.update(
        'bookmarks',
        bookmarks.filter(b => b.path !== target.fsPath),
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
    configWatcher
  );
}

export function deactivate() {}
