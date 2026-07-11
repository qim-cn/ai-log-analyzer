export interface AISettings {
  base_url: string;
  api_key_set: boolean;
  model: string;
  ollama_base_url: string;
}

export interface ModelsResponse {
  openai_models: string[];
  ollama_models: string[];
}

export interface EmbeddingSettings {
  provider: string;
  model: string;
  base_url: string;
  api_key_set: boolean;
}
