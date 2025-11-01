import { Component, ChangeDetectionStrategy, signal, inject } from '@angular/core';
import { GeminiService, GroundedResponse } from '../../services/gemini.service';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-ai-search',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './ai-search.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiSearchComponent {
    private geminiService = inject(GeminiService);

    prompt = signal('');
    isLoading = signal(false);
    result = signal<GroundedResponse | null>(null);
    error = signal('');

    async search() {
        if (!this.prompt().trim()) return;

        this.isLoading.set(true);
        this.result.set(null);
        this.error.set('');

        try {
            const response = await this.geminiService.getGroundedResponse(this.prompt());
            this.result.set(response);
        } catch (err) {
            this.error.set(err instanceof Error ? err.message : 'Произошла неизвестная ошибка.');
        } finally {
            this.isLoading.set(false);
        }
    }
}
