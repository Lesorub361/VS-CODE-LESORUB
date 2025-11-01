import { Component, ChangeDetectionStrategy, input, output, ViewChild, ElementRef, effect } from '@angular/core';

export interface ConsoleLog {
  type: 'log' | 'warn' | 'error' | 'info' | 'debug';
  data: any[];
  timestamp: string;
}

@Component({
  selector: 'app-console',
  standalone: true,
  imports: [],
  templateUrl: './console.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppConsoleComponent {
  logs = input.required<ConsoleLog[]>();
  clear = output<void>();

  @ViewChild('logContainer') private logContainer?: ElementRef<HTMLDivElement>;

  constructor() {
    effect(() => {
        this.logs();
        setTimeout(() => this.scrollToBottom(), 0);
    });
  }

  formatLog(data: any): string {
    return data.map((arg: any) => {
      if (typeof arg === 'string') return arg;
      if (arg && arg.__error) return arg.message;
      return JSON.stringify(arg, null, 2);
    }).join(' ');
  }

  getIcon(type: ConsoleLog['type']): { icon: string; color: string } {
    switch (type) {
      case 'warn': return { icon: '⚠️', color: 'text-amber-500 dark:text-amber-400' };
      case 'error': return { icon: '❌', color: 'text-red-500 dark:text-red-400' };
      case 'info': return { icon: 'ℹ️', color: 'text-sky-500 dark:text-sky-400' };
      default: return { icon: '', color: '' };
    }
  }

  getLogClasses(log: ConsoleLog): string {
    const baseClasses = 'flex items-start gap-2 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800/50';
    switch (log.type) {
      case 'warn': return `${baseClasses} text-amber-700 dark:text-amber-400`;
      case 'error': return `${baseClasses} text-red-700 dark:text-red-500`;
      case 'info': return `${baseClasses} text-sky-700 dark:text-sky-400`;
      default: return baseClasses;
    }
  }

  private scrollToBottom(): void {
    if (this.logContainer) {
      this.logContainer.nativeElement.scrollTop = this.logContainer.nativeElement.scrollHeight;
    }
  }
}
