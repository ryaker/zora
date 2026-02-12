/**
 * Web Tools — Fetch content from the web.
 *
 * Spec §5.3 "Built-in Tools":
 *   - web_fetch
 */

export interface WebResult {
  success: boolean;
  content?: string;
  error?: string;
  status?: number;
  url?: string;
}

export class WebTools {
  /**
   * Fetches content from a URL.
   * In a full implementation, this might convert HTML to Markdown.
   * For v1, we retrieve the raw body.
   */
  async fetch(url: string): Promise<WebResult> {
    try {
      const response = await globalThis.fetch(url);
      
      if (!response.ok) {
        return {
          success: false,
          status: response.status,
          error: `HTTP error! status: ${response.status}`,
          url,
        };
      }

      const content = await response.text();
      return {
        success: true,
        status: response.status,
        content,
        url,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Failed to fetch URL: ${msg}`,
        url,
      };
    }
  }
}
