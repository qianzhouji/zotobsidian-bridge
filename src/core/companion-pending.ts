export interface CompanionPendingWindowState {
  headline: string;
  detail: string;
  finished: boolean;
  render?: () => void;
}
