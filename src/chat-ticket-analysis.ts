export const analyzeTicketEvent = "orbit:analyze-ticket";
export const analysisChatReadyEvent = "orbit:analysis-chat-ready";
export type AnalyzeTicketRequest = {
  reference: string;
  resolve: () => void;
  reject: (error: Error) => void;
};
export function openTicketAnalysis(reference: string) {
  return new Promise<void>((resolve, reject) => {
    window.dispatchEvent(
      new CustomEvent<AnalyzeTicketRequest>(analyzeTicketEvent, {
        detail: { reference, resolve, reject },
      }),
    );
  });
}
