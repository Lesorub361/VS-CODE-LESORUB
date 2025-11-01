import { Component, ChangeDetectionStrategy, signal, inject } from '@angular/core';
import { GeminiService } from '../../services/gemini.service';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-image-analyzer',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './image-analyzer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageAnalyzerComponent {
    private geminiService = inject(GeminiService);

    prompt = signal('');
    isLoading = signal(false);
    result = signal('');
    error = signal('');
    uploadedImage = signal<string | null>(null);
    imageMimeType = signal<string | null>(null);

    onFileSelected(event: Event): void {
        const input = event.target as HTMLInputElement;
        if (input.files && input.files[0]) {
            const file = input.files[0];
            if (!file.type.startsWith('image/')) {
                this.error.set('Пожалуйста, выберите файл изображения.');
                return;
            }
            this.error.set('');
            this.imageMimeType.set(file.type);
            const reader = new FileReader();
            reader.onload = (e: any) => {
                const base64String = e.target.result.split(',')[1];
                this.uploadedImage.set(base64String);
            };
            reader.readAsDataURL(file);
        }
    }

    removeImage(): void {
        this.uploadedImage.set(null);
        this.imageMimeType.set(null);
        this.result.set('');
        this.error.set('');
    }

    async analyze(): Promise<void> {
        const image = this.uploadedImage();
        const mimeType = this.imageMimeType();
        const userPrompt = this.prompt();

        if (!image || !mimeType || !userPrompt.trim()) {
            return;
        }

        this.isLoading.set(true);
        this.result.set('');
        this.error.set('');

        try {
            const response = await this.geminiService.analyzeImage(image, mimeType, userPrompt);
            this.result.set(response);
        } catch (err) {
            this.error.set(err instanceof Error ? err.message : 'Произошла неизвестная ошибка.');
        } finally {
            this.isLoading.set(false);
        }
    }
}
