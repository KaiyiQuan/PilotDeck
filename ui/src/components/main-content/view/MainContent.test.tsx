// @vitest-environment jsdom
import type { ComponentProps, ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppTab, Project } from '../../../types/app';
import MainContent from './MainContent';

const mocks = vi.hoisted(() => ({
  handleFileOpen: vi.fn(),
  onMisroutedFileUrlHandled: vi.fn(),
  getFiles: vi.fn(),
  upload: vi.fn(),
}));

vi.mock('../../../utils/api', () => ({
  api: {
    getFiles: mocks.getFiles,
    uploadLimits: async () => ({ ok: true, json: async () => ({ maxFiles: 500, maxFileBytes: 1024 ** 3, maxTaskBytes: 2 * 1024 ** 3 }) }),
    checkWorkspaceUpload: async () => ({ ok: true, json: async () => ({ success: true }) }),
    uploadFiles: mocks.upload,
  },
}));

vi.mock('../../../contexts/TaskMasterContext', () => ({
  useTaskMaster: () => ({
    currentProject: { name: 'pilotdeck' },
    setCurrentProject: vi.fn(),
  }),
}));

vi.mock('../../../contexts/TasksSettingsContext', () => ({
  useTasksSettings: () => ({
    tasksEnabled: false,
    isTaskMasterInstalled: false,
    isTaskMasterReady: false,
  }),
}));

vi.mock('../../../hooks/useUiPreferences', () => ({
  useUiPreferences: () => ({
    preferences: {
      autoExpandTools: false,
      showThinking: false,
      inlineThinking: false,
      autoScrollToBottom: true,
      sendByCtrlEnter: false,
    },
  }),
}));

vi.mock('../../code-editor/hooks/useEditorSidebar', () => ({
  useEditorSidebar: () => ({
    editorTabs: [{
      id: 'editor-tab-0',
      fileStack: [{
        name: 'report.pdf',
        path: '/workspace/PilotDeck/report.pdf',
        projectName: 'pilotdeck',
        diffInfo: null,
      }],
      dirty: false,
    }],
    activeEditorTabId: 'editor-tab-0',
    activeFilePath: '/workspace/PilotDeck/report.pdf',
    editingFile: {
      name: 'report.pdf',
      path: '/workspace/PilotDeck/report.pdf',
      projectName: 'pilotdeck',
      diffInfo: null,
    },
    editorWidth: 600,
    editorExpanded: false,
    hasManualWidth: false,
    resizeHandleRef: { current: null },
    handleFileOpen: mocks.handleFileOpen,
    handlePreviewFileOpen: vi.fn(),
    handleFileGoBack: vi.fn(),
    handleTabSelect: vi.fn(),
    handleTabClose: vi.fn(),
    handleTabDirtyChange: vi.fn(),
    handleFileRename: vi.fn(),
    handleFileDelete: vi.fn(),
    handleToggleEditorExpand: vi.fn(),
    handleResizeStart: vi.fn(),
  }),
}));

vi.mock('../../code-editor/view/EditorSidebar', () => ({
  default: () => <div data-testid="editor-sidebar" />,
}));

vi.mock('../../chat-v2/ChatInterfaceV2', () => ({
  default: ({ onFileOpen }: { onFileOpen: (filePath: string) => void }) => (
    <button type="button" onClick={() => onFileOpen('/workspace/PilotDeck/generated.pptx')}>
      Open workspace file
    </button>
  ),
}));

vi.mock('../../plugins/view/PluginTabContent', () => ({
  default: () => null,
}));

vi.mock('./ErrorBoundary', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));

class ResizeObserverMock {
  observe() {}

  disconnect() {}
}

const project: Project = {
  name: 'pilotdeck',
  displayName: 'PilotDeck',
  fullPath: '/workspace/PilotDeck',
};

function propsFor(activeTab: AppTab, setActiveTab = vi.fn()) {
  return {
    projects: [project],
    selectedProject: project,
    selectedSession: null,
    activeTab,
    setActiveTab,
    ws: null,
    sendMessage: vi.fn(),
    latestMessage: null,
    isMobile: false,
    onMenuClick: vi.fn(),
    isLoading: false,
    onInputFocusChange: vi.fn(),
    onSessionActive: vi.fn(),
    onSessionInactive: vi.fn(),
    onSessionProcessing: vi.fn(),
    onSessionNotProcessing: vi.fn(),
    processingSessions: new Set<string>(),
    unreadSessionIds: new Set<string>(),
    onReplaceTemporarySession: vi.fn(),
    onNavigateToSession: vi.fn(),
    onStartNewSession: vi.fn(),
    onShowSettings: vi.fn(),
    externalMessageUpdate: 0,
  } as unknown as ComponentProps<typeof MainContent>;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  localStorage.clear();
  mocks.handleFileOpen.mockReset();
  mocks.onMisroutedFileUrlHandled.mockReset();
  mocks.getFiles.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
  mocks.upload.mockReset();
});

describe('workspace uploads across panel visibility changes', () => {
  async function startUpload() {
    const view = render(<MainContent {...propsFor('files')} />);
    const toggle = await screen.findByRole('button', { name: /filesWorkbench\.fileDirectory|^Files$/ });
    if (toggle.getAttribute('aria-pressed') !== 'true') fireEvent.click(toggle);
    await waitFor(() => expect(view.container.querySelector('input[type="file"]')).not.toBeNull());
    const file = new File(['upload contents'], 'large.txt');
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledOnce());
    return { ...view, file, toggle, options: mocks.upload.mock.calls[0][2] };
  }

  it.each(['chat', 'collapse'] as const)('continues uploading when hiding the explorer via %s', async (hide) => {
    let finish!: (value: unknown) => void;
    mocks.upload.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { rerender, file, toggle, options } = await startUpload();
    if (hide === 'chat') rerender(<MainContent {...propsFor('chat')} />);
    else fireEvent.click(toggle);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(options.signal.aborted).toBe(false);

    act(() => options.onProgress(45));
    if (hide === 'chat') {
      rerender(<MainContent {...propsFor('files')} />);
      fireEvent.click(screen.getByRole('button', { name: /filesWorkbench\.fileDirectory|^Files$/ }));
    } else fireEvent.click(toggle);
    expect(await screen.findByRole('progressbar')).toHaveProperty('ariaValueNow', '45');
    expect(mocks.upload).toHaveBeenCalledOnce();

    const readsBeforeSave = mocks.getFiles.mock.calls.length;
    await act(async () => finish({ ok: true, body: { files: [{ name: file.name, size: file.size }], errors: [] } }));
    expect(screen.getByRole('status').textContent).toContain('fileTree.uploadStatus.completed');
    await waitFor(() => expect(mocks.getFiles.mock.calls.length).toBeGreaterThan(readsBeforeSave));
  });

  it('shows completion and refreshed files when the upload finishes while the explorer is hidden', async () => {
    let finish!: (value: unknown) => void;
    mocks.upload.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { toggle, file, options } = await startUpload();
    fireEvent.click(toggle);
    expect(options.signal.aborted).toBe(false);
    mocks.getFiles.mockResolvedValue({ ok: true, json: async () => [{ name: file.name, path: `/workspace/PilotDeck/${file.name}`, type: 'file' }] });
    await act(async () => finish({ ok: true, body: { files: [{ name: file.name, size: file.size }], errors: [] } }));
    fireEvent.click(toggle);
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'fileTree.uploadStatus.completed');
    await waitFor(() => expect(screen.getAllByText(file.name).length).toBeGreaterThan(1));
  });

  it('keeps failures and retry available after reopening the explorer, and still supports explicit cancellation', async () => {
    let fail!: (reason: unknown) => void;
    mocks.upload.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }))
      .mockImplementationOnce((_project, _form, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }));
    const { toggle } = await startUpload();
    fireEvent.click(toggle);
    await act(async () => fail(new Error('UPLOAD_NETWORK_ERROR')));
    fireEvent.click(toggle);
    fireEvent.click(await screen.findByRole('button', { name: 'fileTree.uploadStatus.retry' }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'fileTree.uploadStatus.cancel' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('fileTree.uploadStatus.cancelled'));
    expect(mocks.upload.mock.calls[1][2].signal.aborted).toBe(true);
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('MainContent file workspace routing', () => {
  it('routes every chat file open into the Files workbench', async () => {
    const setActiveTab = vi.fn();
    const { rerender } = render(<MainContent {...propsFor('files', setActiveTab)} />);

    expect(await screen.findByTestId('editor-sidebar')).not.toBeNull();

    rerender(<MainContent {...propsFor('chat', setActiveTab)} />);
    expect(screen.queryByTestId('editor-sidebar')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open workspace file' }));
    expect(mocks.handleFileOpen).toHaveBeenCalledWith(
      '/workspace/PilotDeck/generated.pptx',
      null,
    );
    expect(setActiveTab).toHaveBeenCalledWith('files');
    expect(screen.queryByTestId('editor-sidebar')).toBeNull();
  });

  it('routes a file-shaped session URL into Files instead of chat', async () => {
    const setActiveTab = vi.fn();
    render(
      <MainContent
        {...propsFor('chat', setActiveTab)}
        misroutedFileFromUrl="/workspace/PilotDeck/report.pdf"
        onMisroutedFileUrlHandled={mocks.onMisroutedFileUrlHandled}
      />,
    );

    await waitFor(() => {
      expect(mocks.handleFileOpen).toHaveBeenCalledWith(
        '/workspace/PilotDeck/report.pdf',
        null,
      );
    });
    expect(setActiveTab).toHaveBeenCalledWith('files');
    expect(setActiveTab).not.toHaveBeenCalledWith('chat');
    expect(mocks.onMisroutedFileUrlHandled).toHaveBeenCalledOnce();
  });

  it('keeps the agent panel collapsible and persists keyboard resizing', async () => {
    render(<MainContent {...propsFor('files')} />);

    const conversationTrigger = await screen.findByTestId('files-conversation-switcher-trigger');
    expect(conversationTrigger.textContent).toContain('filesWorkbench.conversations.newConversation');
    expect(screen.getByRole('button', {
      name: 'filesWorkbench.conversations.newConversation',
    })).toBeTruthy();

    const resizeHandle = screen.getByRole('separator', {
      name: 'filesWorkbench.resizeAssistant',
    });
    expect(resizeHandle.getAttribute('aria-valuenow')).toBe('380');

    fireEvent.keyDown(resizeHandle, { key: 'ArrowLeft' });
    expect(resizeHandle.getAttribute('aria-valuenow')).toBe('396');
    await waitFor(() => {
      expect(localStorage.getItem('pilotdeck:files-assistant-width')).toBe('396');
    });

    const smartChatToggle = screen.getByRole('button', { name: /filesWorkbench\.smartChat|Smart Chat/ });
    expect(smartChatToggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(smartChatToggle);
    expect(screen.queryByRole('separator', { name: 'filesWorkbench.resizeAssistant' })).toBeNull();
    expect(smartChatToggle.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(smartChatToggle);
    expect(screen.getByRole('separator', {
      name: 'filesWorkbench.resizeAssistant',
    }).getAttribute('aria-valuenow')).toBe('396');
    expect(smartChatToggle.getAttribute('aria-pressed')).toBe('true');
  });
});
