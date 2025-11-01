import { Component, ChangeDetectionStrategy, signal, computed, inject, effect, ViewChild, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { debounceTime, map, distinctUntilChanged } from 'rxjs/operators';
import { GeminiService } from './services/gemini.service';
import { MonacoEditorComponent } from './components/monaco-editor/monaco-editor.component';
import { AiSearchComponent } from './components/ai-search/ai-search.component';
import { AppConsoleComponent, ConsoleLog } from './components/console/console.component';
import { ImageAnalyzerComponent } from './components/image-analyzer/image-analyzer.component';

declare var Split: any;

type EditorType = 'html' | 'css' | 'js' | 'ts' | 'json' | 'md' | 'scss' | 'xml' | 'svg' | 'txt' | 'yaml';
type ViewType = 'explorer' | 'settings' | 'image-analyzer';
type GeminiModel = 'gemini-2.5-flash' | 'gemini-1.5-pro' | 'gemini-1.5-flash';
type AiContextMenuAction = 'explain' | 'bugs' | 'refactor' | 'comment';

interface File {
  name: string;
  content: string;
  language: EditorType;
}

interface Command {
    id: string;
    name: string;
    action: () => void;
}

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MonacoEditorComponent,
    AiSearchComponent,
    AppConsoleComponent,
    ImageAnalyzerComponent,
  ],
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'onKeydownHandler($event)',
    '(window:message)': 'onMessage($event)',
  },
})
export class AppComponent implements AfterViewInit, OnDestroy {
  private geminiService = inject(GeminiService);
  
  title = 'AI Веб-редактор кода';

  private readonly STORAGE_PREFIX = 'ai-code-editor-v2-';
  private readonly FILES_STORAGE_KEY = `${this.STORAGE_PREFIX}files`;
  private readonly THEME_STORAGE_KEY = `${this.STORAGE_PREFIX}theme`;
  private readonly API_KEY_STORAGE_KEY = `${this.STORAGE_PREFIX}api-key`;
  
  private readonly SUPPORTED_EXTENSIONS: EditorType[] = ['html', 'css', 'js', 'ts', 'json', 'md', 'scss', 'xml', 'svg', 'txt', 'yaml'];
  private readonly SUPPORTED_EXTENSIONS_REGEX = new RegExp(`\\.(${this.SUPPORTED_EXTENSIONS.join('|')})$`);
  private readonly SUPPORTED_EXTENSIONS_USER_MSG = this.SUPPORTED_EXTENSIONS.map(ext => `.${ext}`).join(', ');

  
  @ViewChild('newFileInput') private newFileInput?: ElementRef<HTMLInputElement>;
  @ViewChild(MonacoEditorComponent) private editorComponent?: MonacoEditorComponent;
  @ViewChild('previewIframe') private previewIframe!: ElementRef<HTMLIFrameElement>;
  
  onDocumentClick(event: MouseEvent) {
    if (this.isContextMenuVisible()) {
        this.isContextMenuVisible.set(false);
    }
  }
  
  onKeydownHandler(event: KeyboardEvent) {
    if (this.isCommandPaletteOpen()) {
      this.isCommandPaletteOpen.set(false);
    }
     if (this.isContextMenuVisible()) {
      this.isContextMenuVisible.set(false);
    }
  }

  onMessage(event: MessageEvent) {
    if (event.source !== this.previewIframe.nativeElement.contentWindow) {
      return;
    }
    const { type, payload } = event.data;
    if (type === 'CONSOLE_LOG') {
      this.consoleLogs.update(logs => [...logs, payload]);
    }
  }

  // UI State
  apiKey = signal<string>(this.loadFromStorage(this.API_KEY_STORAGE_KEY, ''));
  theme = signal<'light' | 'dark'>(this.loadFromStorage(this.THEME_STORAGE_KEY, 'light'));
  isSidebarVisible = signal<boolean>(true);
  isConsoleVisible = signal<boolean>(true);
  activeView = signal<ViewType>('explorer');
  isAiPaneVisible = signal<boolean>(true);
  activeAiView = signal<'ai' | 'search'>('ai');

  // Split.js instances
  private mainSplitInstance: any;
  private mainContentSplitInstance: any;
  private editorSplitInstance: any;
  private editorPreviewSplitInstance: any;
  
  // File System State
  files = signal<File[]>(this.loadFilesFromStorage());
  openFiles = signal<File[]>(this.files().filter(f => ['index.html', 'style.css', 'script.js'].includes(f.name)));
  activeFile = signal<File | null>(this.openFiles().length > 0 ? this.openFiles()[0] : null);
  isCreatingFile = signal(false);
  newFileName = signal('');

  iframeSrcDoc = toSignal(
    toObservable(this.files).pipe(
      debounceTime(300),
      map(files => this.buildIframeContent(files))
    ),
    { initialValue: this.buildIframeContent(this.files()) }
  );
  
  // Console state
  consoleLogs = signal<ConsoleLog[]>([]);

  // AI Assistant State
  aiPrompt = signal<string>('');
  isAiLoading = signal<boolean>(false);
  isAiApplyingEdits = signal<boolean>(false);
  aiExplanation = signal<string>('');
  aiError = signal<string>('');
  selectedModel = signal<GeminiModel>('gemini-2.5-flash');
  availableModels: GeminiModel[] = ['gemini-2.5-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'];
  
  // Command Palette
  isCommandPaletteOpen = signal(false);
  commandPaletteSearch = signal('');
  
  private allCommands: Command[] = [
    { id: 'toggleTheme', name: '> Тема: Переключить Светлую/Темную тему', action: () => this.toggleTheme() },
    { id: 'newFile', name: '> Файл: Создать новый файл', action: () => this.startCreatingFile() },
    { id: 'formatDocument', name: '> Редактор: Форматировать документ', action: () => this.formatActiveFile() },
    { id: 'toggleConsole', name: '> Вид: Открыть/Закрыть консоль', action: () => this.isConsoleVisible.update(v => !v) },
    { id: 'openExplorer', name: '> Перейти: Проводник', action: () => this.activeView.set('explorer') },
    { id: 'openAiAssistant', name: '> Перейти: AI Помощник', action: () => this.setActiveAiView('ai') },
    { id: 'openAiSearch', name: '> Перейти: AI-исследователь', action: () => this.setActiveAiView('search') },
    { id: 'openImageAnalyzer', name: '> Перейти: Анализатор изображений', action: () => this.activeView.set('image-analyzer') },
    { id: 'openSettings', name: '> Перейти: Настройки', action: () => this.activeView.set('settings') },
  ];
  
  filteredCommands = computed(() => {
    const term = this.commandPaletteSearch().toLowerCase().replace('>', '').trim();
    if (!term) return this.allCommands;
    return this.allCommands.filter(cmd => cmd.name.toLowerCase().includes(term));
  });

  // AI Context Menu
  isContextMenuVisible = signal(false);
  contextMenuPosition = signal({ x: 0, y: 0 });
  private contextMenuSelection = '';


  constructor() {
    effect(() => this.saveToStorage(this.FILES_STORAGE_KEY, JSON.stringify(this.files())));
    effect(() => this.saveToStorage(this.THEME_STORAGE_KEY, JSON.stringify(this.theme())));
    effect(() => {
        const key = this.apiKey();
        this.saveToStorage(this.API_KEY_STORAGE_KEY, JSON.stringify(key));
        this.geminiService.setApiKey(key);
    });
    
    // Effect to handle pane visibility changes AFTER initial setup
    effect(() => {
        this.updateSplitVisibility();
    });
    
    // Effect to focus input when creating a file
    effect(() => {
        if (this.isCreatingFile()) {
            setTimeout(() => this.newFileInput?.nativeElement.focus(), 0);
        }
    });

    // Initial API Key setup
    this.geminiService.setApiKey(this.apiKey());
  }

  ngAfterViewInit(): void {
    // Defer split initialization until after the view is stable
    setTimeout(() => this.setupSplits(), 100);
  }

  ngOnDestroy(): void {
    this.destroySplits();
  }
  
  // --- Storage Management ---
  private saveToStorage(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch(e) {
      console.error("Failed to save to localStorage", e);
    }
  }
  
  private loadFromStorage<T>(key: string, defaultValue: T): T {
    try {
      const value = localStorage.getItem(key);
      if (value) {
        return JSON.parse(value) as T;
      }
    } catch (e) {
      console.error("Failed to load from localStorage", e);
      // If parsing fails, the data is likely in the old, raw string format or corrupted.
      // We'll remove it to prevent repeated errors on subsequent loads.
      try {
        localStorage.removeItem(key);
      } catch (removeError) {
        console.error(`Failed to remove corrupted item '${key}' from localStorage`, removeError);
      }
      return defaultValue;
    }
    return defaultValue;
  }
  

  // --- Theme Management ---
  toggleTheme() {
    this.theme.update(current => current === 'dark' ? 'light' : 'dark');
  }

  // --- Resizable Panes ---
  private destroySplits() {
    if (this.mainSplitInstance) this.mainSplitInstance.destroy();
    if (this.mainContentSplitInstance) this.mainContentSplitInstance.destroy();
    if (this.editorSplitInstance) this.editorSplitInstance.destroy();
    if (this.editorPreviewSplitInstance) this.editorPreviewSplitInstance.destroy();
    this.mainSplitInstance = null;
    this.mainContentSplitInstance = null;
    this.editorSplitInstance = null;
    this.editorPreviewSplitInstance = null;
  }

  private setupSplits(attempt = 1) {
    if (typeof Split === 'undefined') {
        if (attempt < 20) {
             setTimeout(() => this.setupSplits(attempt + 1), 100);
        } else {
            console.error("Split.js library not loaded after multiple attempts.");
        }
        return;
    }

    this.destroySplits();

    const commonGutterOptions = {
        gutterSize: 8,
        elementStyle: (_: any, size: any, gutterSize: any) => ({ 'flex-basis': `calc(${size}% - ${gutterSize}px)` }),
        gutterStyle: (_: any, gutterSize: any) => ({ 'flex-basis': `${gutterSize}px` }),
    };

    // Main horizontal split (Sidebar + Main Content)
    this.mainSplitInstance = Split(['#sidebar-pane', '#main-content-wrapper'], {
        ...commonGutterOptions,
        sizes: [20, 80],
        minSize: [280, 400],
        cursor: 'col-resize',
    });

    // Main Content horizontal split (Editor Block + AI Pane)
    this.mainContentSplitInstance = Split(['#editor-and-preview-block', '#ai-pane'], {
        ...commonGutterOptions,
        sizes: [65, 35],
        minSize: [400, 320],
        cursor: 'col-resize',
    });

    // Horizontal split (Editor + Preview)
    this.editorPreviewSplitInstance = Split(['#editor-area-wrapper', '#preview-pane'], {
        ...commonGutterOptions,
        sizes: [50, 50],
        minSize: [300, 300],
        cursor: 'col-resize',
    });

    // Vertical split (Upper Area + Console)
    this.editorSplitInstance = Split(['#upper-pane', '#console-pane'], {
        ...commonGutterOptions,
        direction: 'vertical',
        sizes: [70, 30],
        minSize: [200, 80],
        cursor: 'row-resize',
    });

    // Set initial visibility
    this.updateSplitVisibility();
  }

  private updateSplitVisibility() {
    if (this.mainSplitInstance) {
        const sidebarVisible = this.isSidebarVisible();
        const currentSizes = this.mainSplitInstance.getSizes();
        if (sidebarVisible && currentSizes[0] < 5) {
            this.mainSplitInstance.setSizes([20, 80]);
        } else if (!sidebarVisible && currentSizes[0] > 5) {
            this.mainSplitInstance.collapse(0);
        }
    }
     if (this.mainContentSplitInstance) {
        const aiPaneVisible = this.isAiPaneVisible();
        const currentSizes = this.mainContentSplitInstance.getSizes();
        if (aiPaneVisible && currentSizes[1] < 5) {
            this.mainContentSplitInstance.setSizes([65, 35]);
        } else if (!aiPaneVisible && currentSizes[1] > 5) {
            this.mainContentSplitInstance.collapse(1);
        }
    }
    if (this.editorSplitInstance) {
        const consoleVisible = this.isConsoleVisible();
        const currentSizes = this.editorSplitInstance.getSizes();
        if (consoleVisible && currentSizes[1] < 5) {
            this.editorSplitInstance.setSizes([70, 30]);
        } else if (!consoleVisible && currentSizes[1] > 5) {
            this.editorSplitInstance.collapse(1);
        }
    }
  }


  // --- File Management ---
  updateActiveFileContent(newContent: string) {
    const active = this.activeFile();
    if (active) {
      this.updateFileContent(active.name, newContent);
    }
  }

  updateFileContent(fileName: string, newContent: string) {
    this.files.update(currentFiles =>
        currentFiles.map(f => (f.name === fileName ? { ...f, content: newContent } : f))
    );
  }
  
  setActiveFile(file: File) {
    if (!this.openFiles().some(f => f.name === file.name)) {
        this.openFiles.update(files => [...files, file]);
    }
    this.activeFile.set(file);
  }

  closeFile(fileToClose: File, event: MouseEvent) {
    event.stopPropagation();
    const openFiles = this.openFiles();
    const currentIndex = openFiles.findIndex(f => f.name === fileToClose.name);
    if (currentIndex === -1) return;

    const newOpenFiles = openFiles.filter(f => f.name !== fileToClose.name);

    if (this.activeFile()?.name === fileToClose.name) {
        if (newOpenFiles.length === 0) {
            this.activeFile.set(null);
        } else {
            const newIndex = Math.min(currentIndex, newOpenFiles.length - 1);
            this.activeFile.set(newOpenFiles[newIndex]);
        }
    }
    
    this.openFiles.set(newOpenFiles);
  }

  startCreatingFile() {
    this.isCreatingFile.set(true);
  }

  cancelCreateFile() {
    this.isCreatingFile.set(false);
    this.newFileName.set('');
  }

  confirmCreateFile() {
    const fileName = this.newFileName().trim();
    if (!fileName) {
        this.cancelCreateFile();
        return;
    }
    if (!fileName.match(this.SUPPORTED_EXTENSIONS_REGEX)) {
        alert(`Неверное имя файла. Используйте: ${this.SUPPORTED_EXTENSIONS_USER_MSG}`);
        return;
    }
    if (this.files().some(f => f.name === fileName)) {
        alert('Файл с таким именем уже существует.');
        return;
    }
    const language = fileName.split('.').pop() as EditorType;
    const newFile: File = { name: fileName, content: ``, language };
    this.files.update(files => [...files, newFile]);
    this.setActiveFile(newFile);
    this.cancelCreateFile();
  }

  deleteFile(fileToDelete: File, event: MouseEvent) {
    event.stopPropagation();
    if (!confirm(`Вы уверены, что хотите удалить ${fileToDelete.name}? Это действие необратимо.`)) return;

    if (this.openFiles().some(f => f.name === fileToDelete.name)) {
        const mockEvent = { stopPropagation: () => {} } as MouseEvent;
        this.closeFile(fileToDelete, mockEvent);
    }

    this.files.update(files => files.filter(f => f.name !== fileToDelete.name));
  }

  handleFileUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;

    for (const file of Array.from(input.files)) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target?.result as string;
            const name = file.name;
            if (this.files().some(f => f.name === name)) {
                if (!confirm(`Файл ${name} уже существует. Перезаписать?`)) return;
                this.files.update(files => files.filter(f => f.name !== name));
            }
             const language = name.split('.').pop() as EditorType;
             if (!this.SUPPORTED_EXTENSIONS.includes(language)) {
                alert(`Файл ${name} имеет неподдерживаемое расширение.`);
                return;
             }
            const newFile: File = { name, content, language };
            this.files.update(files => [...files, newFile]);
            this.setActiveFile(newFile);
        };
        reader.readAsText(file);
    }
    input.value = ''; // Reset input
  }

  private getConsoleInterceptorScript(): string {
    return `
      const originalConsole = { ...window.console };
      const postLog = (type, args) => {
        try {
          // Serialize arguments for posting
          const serializedArgs = args.map(arg => {
            if (arg instanceof Error) {
              return { __error: true, message: arg.message, stack: arg.stack };
            }
            try {
                // Attempt to stringify, handle circular references
                return JSON.parse(JSON.stringify(arg, (key, value) => {
                    return typeof value === 'bigint' ? value.toString() + 'n' : value;
                }));
            } catch (e) {
                return 'Unserializable Object';
            }
          });
          window.parent.postMessage({ type: 'CONSOLE_LOG', payload: { type, data: serializedArgs, timestamp: new Date().toISOString() } }, '*');
        } catch (e) {
          originalConsole.error('Error posting log to parent:', e);
        }
      };

      window.console.log = (...args) => { originalConsole.log(...args); postLog('log', args); };
      window.console.warn = (...args) => { originalConsole.warn(...args); postLog('warn', args); };
      window.console.error = (...args) => { originalConsole.error(...args); postLog('error', args); };
      window.console.info = (...args) => { originalConsole.info(...args); postLog('info', args); };
      window.console.debug = (...args) => { originalConsole.debug(...args); postLog('debug', args); };

      window.addEventListener('error', event => {
        postLog('error', [event.message]);
      });
      window.addEventListener('unhandledrejection', event => {
        postLog('error', ['Unhandled promise rejection:', event.reason]);
      });
    `;
  }

  private buildIframeContent(files: File[]): string {
    const htmlFile = files.find(f => f.language === 'html');
    const cssFile = files.find(f => f.language === 'css');
    const jsFile = files.find(f => f.language === 'js');
    return `
      <html>
        <head>
          <style>${cssFile?.content ?? ''}</style>
          <script>${this.getConsoleInterceptorScript()}<\/script>
        </head>
        <body>
          ${htmlFile?.content ?? '<!-- Создайте HTML файл для предпросмотра -->'}
          <script>${jsFile?.content ?? ''}<\/script>
        </body>
      </html>
    `;
  }
  
  forcePreviewRefresh() {
    this.files.update(f => [...f]);
    this.consoleLogs.set([]);
  }

  private loadFilesFromStorage(): File[] {
    const storedFiles = localStorage.getItem(this.FILES_STORAGE_KEY);
    if (storedFiles) {
        try {
          return JSON.parse(storedFiles);
        } catch {
          // Fallback to default if stored data is corrupted
        }
    }
    return [
        { name: 'index.html', content: `<h1>Привет, Мир!</h1>\n<p>Это ваш живой редактор кода.</p>\n<button onclick="logSomething()">Нажми меня</button>`, language: 'html' },
        { name: 'style.css', content: `body { \n  font-family: sans-serif;\n  background: #ffffff;\n  padding: 1rem;\n}`, language: 'css' },
        { name: 'script.js', content: `console.log('Скрипт загружен!');\n\nfunction logSomething() {\n  console.log('Кнопка была нажата в', new Date().toLocaleTimeString());\n  console.warn('Это предупреждение.');\n  console.error('А это — ошибка!');\n}`, language: 'js' },
    ];
  }

  // --- AI ---
  setActiveAiView(view: 'ai' | 'search') {
    this.isAiPaneVisible.set(true);
    this.activeAiView.set(view);
  }

  async askAI() {
    if (!this.aiPrompt().trim()) return;
    this.isAiLoading.set(true);
    this.isAiApplyingEdits.set(false);
    this.aiExplanation.set('');
    this.aiError.set('');

    try {
      const htmlFile = this.files().find(f => f.language === 'html');
      const cssFile = this.files().find(f => f.language === 'css');
      const jsFile = this.files().find(f => f.language === 'js');

      const response = await this.geminiService.getCodeModification(
        htmlFile?.content ?? '',
        cssFile?.content ?? '',
        jsFile?.content ?? '',
        this.aiPrompt(),
        this.selectedModel()
      );

      const diffs: { fileName: string; after: string }[] = [];
      
      if (response.html && response.html !== (htmlFile?.content ?? '')) {
        diffs.push({ fileName: htmlFile?.name ?? 'index.html', after: response.html });
      }
      if (response.css && response.css !== (cssFile?.content ?? '')) {
        diffs.push({ fileName: cssFile?.name ?? 'style.css', after: response.css });
      }
      if (response.js && response.js !== (jsFile?.content ?? '')) {
         diffs.push({ fileName: jsFile?.name ?? 'script.js', after: response.js });
      }
      
      if (diffs.length > 0) {
        this.isAiLoading.set(false);
        this.isAiApplyingEdits.set(true);

        for (const diff of diffs) {
            const fileToUpdate = this.files().find(f => f.name === diff.fileName);
            if (fileToUpdate) {
                this.setActiveFile(fileToUpdate);
                await new Promise(r => setTimeout(r, 50)); // Allow editor to switch
                
                if (this.editorComponent) {
                    await this.editorComponent.applyChangesWithAnimation(diff.after);
                }
                this.updateFileContent(diff.fileName, diff.after);
            }
        }
      }
      
      this.aiExplanation.set(response.explanation);
      if (diffs.length === 0) {
        this.aiExplanation.update(exp => exp + "\n\n(Изменений в коде не предложено)");
      }

    } catch (err) {
      this.aiError.set(err instanceof Error ? err.message : 'Произошла ошибка при обращении к AI.');
      console.error(err);
    } finally {
      this.isAiLoading.set(false);
      this.isAiApplyingEdits.set(false);
    }
  }

  // --- Command Palette ---
  executeCommand(command: Command) {
    command.action();
    this.isCommandPaletteOpen.set(false);
    this.commandPaletteSearch.set('');
  }

  // --- Editor Context Menu & Formatting ---
  formatActiveFile() {
    this.editorComponent?.formatDocument();
  }

  handleEditorContextMenu({ event, selection }: { event: MouseEvent, selection: string }) {
    event.preventDefault();
    event.stopPropagation();
    
    this.contextMenuSelection = selection || this.activeFile()?.content || '';
    if (!this.contextMenuSelection) return;

    this.contextMenuPosition.set({ x: event.clientX, y: event.clientY });
    this.isContextMenuVisible.set(true);
  }

  async runAiContextMenuAction(action: AiContextMenuAction) {
    this.isContextMenuVisible.set(false);
    
    const code = this.contextMenuSelection;
    if (!code) return;

    const language = this.activeFile()?.language || 'code';

    let taskDescription = '';
    switch (action) {
        case 'explain': taskDescription = 'Объясни следующий фрагмент кода'; break;
        case 'bugs': taskDescription = 'Найди потенциальные баги в этом коде'; break;
        case 'refactor': taskDescription = 'Сделай рефакторинг или улучши этот код'; break;
        case 'comment': taskDescription = 'Добавь комментарии к этому коду'; break;
    }

    this.setActiveAiView('ai');
    this.aiPrompt.set(`${taskDescription}:\n\`\`\`${language}\n${code}\n\`\`\``);
    this.isAiLoading.set(true);
    this.aiExplanation.set('');
    this.aiError.set('');

    try {
        const response = await this.geminiService.getGenericCodeAnalysis(code, language, action);
        this.aiExplanation.set(response);
    } catch (err) {
        this.aiError.set(err instanceof Error ? err.message : 'Произошла ошибка при обращении к AI.');
        console.error(err);
    } finally {
        this.isAiLoading.set(false);
    }
  }
}
