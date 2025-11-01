import {
  Component,
  ChangeDetectionStrategy,
  viewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  input,
  output,
  effect,
  untracked,
} from '@angular/core';

declare const monaco: any;
declare const require: any;

@Component({
  selector: 'app-monaco-editor',
  standalone: true,
  template: `<div #editorContainer class="w-full h-full"></div>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MonacoEditorComponent implements AfterViewInit, OnDestroy {
  editorContainer = viewChild.required<ElementRef<HTMLDivElement>>('editorContainer');

  language = input.required<string>();
  content = input.required<string>();
  theme = input<'light' | 'dark'>('dark');

  contentChange = output<string>();
  contextMenuAction = output<{ event: MouseEvent, selection: string }>();

  private editor?: any;
  private resizeObserver?: ResizeObserver;

  private static monacoLoadingPromise: Promise<void> | null = null;

  private isViewReady = false;
  private isAnimating = false;

  constructor() {
    // Effect to handle content changes from parent
    effect(() => {
      const newContent = this.content();
      if (this.editor && !this.isAnimating && this.editor.getValue() !== newContent) {
        // Preserve cursor position and scroll state on external update
        const model = this.editor.getModel();
        const state = this.editor.saveViewState();
        untracked(() => model.setValue(newContent));
        if (state) {
            this.editor.restoreViewState(state);
        }
      }
    });

    // Effect to handle language changes
    effect(() => {
        const newLang = this.language();
        if (this.editor && this.isViewReady) {
            monaco.editor.setModelLanguage(this.editor.getModel(), this.mapLanguage(newLang));
        }
    });

    // Effect to handle theme changes
    effect(() => {
        const newTheme = this.theme();
        if (this.isViewReady) {
            monaco.editor.setTheme(newTheme === 'dark' ? 'vs-dark' : 'vs');
        }
    });
  }

  ngAfterViewInit(): void {
    MonacoEditorComponent.loadMonaco().then(() => {
        this.initEditor();
    }).catch(err => {
        console.error("Monaco Editor failed to load and initialize:", err);
        if (this.editorContainer && this.editorContainer().nativeElement) {
            this.editorContainer().nativeElement.textContent = 'Error: Could not load the code editor.';
        }
    });
  }

  ngOnDestroy(): void {
    if (this.editor) {
      this.editor.dispose();
      this.editor = undefined;
    }
    this.resizeObserver?.disconnect();
  }
  
  private static loadMonaco(): Promise<void> {
    if (this.monacoLoadingPromise) {
      return this.monacoLoadingPromise;
    }

    const promise = new Promise<void>((resolve, reject) => {
      if (typeof monaco !== 'undefined' && typeof monaco.editor !== 'undefined') {
        resolve();
        return;
      }
      
      if (typeof require === 'undefined' || typeof require.config === 'undefined') {
        const message = "Monaco loader script (loader.min.js) not found. Please ensure it's included in your index.html.";
        console.error(message);
        reject(new Error(message));
        return;
      }
      
      try {
        require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' }});
        
        require(
          ['vs/editor/editor.main'],
          () => {
            resolve();
          },
          (error: any) => {
            console.error("Monaco AMD loader failed to load 'vs/editor/editor.main':", error);
            reject(error);
          }
        );
      } catch (e) {
        console.error("An unexpected error occurred during Monaco loader configuration:", e);
        reject(e);
      }
    });
    
    // If the promise fails, reset the static variable so a future attempt can be made.
    promise.catch(() => {
        MonacoEditorComponent.monacoLoadingPromise = null;
    });

    this.monacoLoadingPromise = promise;
    return this.monacoLoadingPromise;
  }

  public formatDocument(): void {
    if (this.editor) {
      this.editor.getAction('editor.action.formatDocument').run();
    }
  }

  public async applyChangesWithAnimation(newContent: string): Promise<void> {
    if (!this.editor) return;

    this.isAnimating = true;
    try {
      const oldContent = this.editor.getValue();
      if (oldContent === newContent) {
        return;
      }

      let prefixLen = 0;
      while (prefixLen < oldContent.length && prefixLen < newContent.length && oldContent[prefixLen] === newContent[prefixLen]) {
        prefixLen++;
      }

      let suffixLen = 0;
      while (suffixLen < oldContent.length - prefixLen && suffixLen < newContent.length - prefixLen && oldContent[oldContent.length - 1 - suffixLen] === newContent[newContent.length - 1 - suffixLen]) {
        suffixLen++;
      }

      const model = this.editor.getModel();
      const startPos = model.getPositionAt(prefixLen);
      const endPos = model.getPositionAt(oldContent.length - suffixLen);
      
      const deleteRange = new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column);
      const textToInsert = newContent.substring(prefixLen, newContent.length - suffixLen);

      this.editor.focus();
      this.editor.setSelection(deleteRange);
      this.editor.revealRangeInCenter(deleteRange, 1 /* Immediate */);
      
      await new Promise(r => setTimeout(r, 300));

      this.editor.executeEdits('ai-delete', [{ range: deleteRange, text: '' }]);
      
      await new Promise(r => setTimeout(r, 200));
      
      await this.typeTextAnimated(textToInsert);

    } finally {
      this.isAnimating = false;
      if (this.editor && this.editor.getValue() !== newContent) {
        this.editor.setValue(newContent);
      }
    }
  }

  private typeTextAnimated(text: string): Promise<void> {
    return new Promise(resolve => {
        let i = 0;
        const type = () => {
            if (i < text.length) {
                const char = text[i];
                const pos = this.editor.getPosition();
                const range = new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column);
                this.editor.executeEdits('ai-type', [{ range, text: char }]);
                i++;
                setTimeout(type, 15);
            } else {
                resolve();
            }
        };
        type();
    });
  }

  private initEditor(): void {
    this.isViewReady = true;
    monaco.editor.setTheme(this.theme() === 'dark' ? 'vs-dark' : 'vs');

    this.editor = monaco.editor.create(this.editorContainer().nativeElement, {
      value: this.content(),
      language: this.mapLanguage(this.language()),
      theme: this.theme() === 'dark' ? 'vs-dark' : 'vs',
      automaticLayout: false,
      minimap: { enabled: true },
      lineNumbers: 'on',
      roundedSelection: false,
      scrollBeyondLastLine: false,
      'semanticHighlighting.enabled': true,
      bracketPairColorization: {
        enabled: true,
      },
    });

    this.editor.getModel().onDidChangeContent(() => {
      if (this.isAnimating) return; // Ignore changes during animation
      const currentContent = this.editor.getValue();
      if (currentContent !== this.content()) {
        this.contentChange.emit(currentContent);
      }
    });

    this.editor.onContextMenu((e: any) => {
        const browserEvent = e?.event?.browserEvent;
        // Ensure we have a valid mouse event. This prevents errors when the context
        // menu is triggered by keyboard, which doesn't create a proper MouseEvent.
        if (browserEvent && typeof browserEvent.preventDefault === 'function') {
            const selection = this.editor.getModel().getValueInRange(this.editor.getSelection());
            this.contextMenuAction.emit({ event: browserEvent, selection });
        }
    });

    this.resizeObserver = new ResizeObserver(() => {
      // Defer layout to next frame to prevent "ResizeObserver loop completed with undelivered notifications."
      requestAnimationFrame(() => this.editor?.layout());
    });
    this.resizeObserver.observe(this.editorContainer().nativeElement);
  }

  private mapLanguage(lang: string): string {
    switch (lang) {
      case 'js': return 'javascript';
      case 'ts': return 'typescript';
      case 'md': return 'markdown';
      case 'scss': return 'scss';
      case 'svg': return 'xml';
      case 'yaml': return 'yaml';
      case 'txt': return 'plaintext';
      default: return lang;
    }
  }
}