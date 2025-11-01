import { Injectable } from '@angular/core';
import { GoogleGenAI, GenerateContentResponse, Type } from '@google/genai';

export interface AiCodeResponse {
  explanation: string;
  html?: string;
  css?: string;
  js?: string;
}

export interface GroundingChunk {
  web: {
    uri: string;
    title: string;
  };
}

export interface GroundedResponse {
  text: string;
  chunks: GroundingChunk[];
}

@Injectable({
  providedIn: 'root'
})
export class GeminiService {
  private ai: GoogleGenAI | null = null;
  private apiKeyInternal: string | null = null;

  constructor() {
    // Initialization is now handled by setApiKey
  }

  setApiKey(key: string) {
    if (key && key.trim() && key !== this.apiKeyInternal) {
      this.apiKeyInternal = key;
      try {
        this.ai = new GoogleGenAI({ apiKey: key });
      } catch (e) {
        console.error('Error initializing GoogleGenAI:', e);
        this.ai = null;
      }
    } else if (!key || !key.trim()) {
      this.apiKeyInternal = null;
      this.ai = null;
    }
  }

  private ensureAiInitialized(): GoogleGenAI {
    if (!this.ai) {
      throw new Error('Ключ API не установлен. Пожалуйста, добавьте его в настройках.');
    }
    return this.ai;
  }
  
  private handleError(error: unknown): never {
    console.error('Gemini API Error:', error);
    if (error instanceof Error) {
        if (error.message.includes('API key not valid')) {
            throw new Error('Ключ API недействителен. Проверьте правильность ключа в настройках.');
        }
        if (error.message.includes('JSON')) {
            throw new Error('AI вернул некорректный формат данных. Попробуйте переформулировать запрос.');
        }
        if (error.message.includes('Ключ API не установлен')) {
            throw error;
        }
    }
    throw new Error('Произошла ошибка при обращении к AI.');
  }

  async getCodeModification(
    html: string,
    css: string,
    js: string,
    prompt: string,
    model: string
  ): Promise<AiCodeResponse> {
    try {
        const ai = this.ensureAiInitialized();
        const systemInstruction = `You are an expert web development AI assistant integrated into a code editor.
The user has provided their current HTML, CSS, and JavaScript code, and a request for modification or generation.
Your task is to fulfill the user's request.
Analyze the provided code and the user's prompt.
Provide a concise explanation of the changes you've made or the code you've generated.
Return the complete, updated code for any languages you modify. If a language's code is not changed, you MUST NOT include its key in the JSON response.
For example, if the user asks to change only the CSS, return the explanation and the full new CSS code in the 'css' field. Do not return 'html' or 'js' fields.
If the user asks to create a new component from scratch, return the code for all three languages.
Respond ONLY with a valid JSON object matching the specified schema.`;

    const fullPrompt = `User's Request: "${prompt}"

Current HTML:
\`\`\`html
${html}
\`\`\`

Current CSS:
\`\`\`css
${css}
\`\`\`

Current JavaScript:
\`\`\`javascript
${js}
\`\`\`
`;

    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            explanation: { type: Type.STRING, description: 'An explanation of the code you are providing.' },
            html: { type: Type.STRING, description: 'The complete, updated HTML code.' },
            css: { type: Type.STRING, description: 'The complete, updated CSS code.' },
            js: { type: Type.STRING, description: 'The complete, updated JavaScript code.' },
        },
        required: ['explanation']
    };
    
      const response: GenerateContentResponse = await ai.models.generateContent({
        model: model,
        contents: fullPrompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema,
          temperature: 0.2,
        },
      });
      
      const jsonString = response.text.trim();
      return JSON.parse(jsonString) as AiCodeResponse;

    } catch (error) {
      this.handleError(error);
    }
  }
  
  async getGenericCodeAnalysis(code: string, language: string, action: 'explain' | 'bugs' | 'refactor' | 'comment'): Promise<string> {
    try {
        const ai = this.ensureAiInitialized();
        let task: string;
        switch (action) {
            case 'explain': task = 'Explain the following code snippet.'; break;
            case 'bugs': task = 'Analyze the following code snippet for potential bugs or errors. Explain them clearly.'; break;
            case 'refactor': task = 'Refactor or improve the following code snippet. Provide the improved code and explain the changes.'; break;
            case 'comment': task = 'Add comments to the following code snippet to explain its functionality. Provide the commented code.'; break;
        }
        
        const systemInstruction = `You are an expert web development AI assistant. A user has selected a piece of code and asked for help. Your task is to provide a clear, concise, and helpful response. Format your response using markdown. If you provide code, use appropriate markdown code blocks.`;

        const fullPrompt = `${task}

Language: ${language}
Code:
\`\`\`${language}
${code}
\`\`\`
`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: fullPrompt,
            config: {
                systemInstruction,
                temperature: 0.3,
            }
        });
        
        return response.text.trim();

    } catch (error) {
        this.handleError(error);
    }
  }

  async analyzeImage(base64Image: string, mimeType: string, prompt: string): Promise<string> {
    try {
      const ai = this.ensureAiInitialized();
      const imagePart = {
        inlineData: {
          mimeType,
          data: base64Image,
        },
      };

      const textPart = {
        text: prompt,
      };

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [imagePart, textPart] },
      });
      
      return response.text;

    } catch (error) {
      this.handleError(error);
    }
  }

  async getGroundedResponse(prompt: string): Promise<GroundedResponse> {
    try {
      const ai = this.ensureAiInitialized();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const text = response.text;
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

      return { text, chunks: chunks as GroundingChunk[] };

    } catch (error) {
      this.handleError(error);
    }
  }
}
