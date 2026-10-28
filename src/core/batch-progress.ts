export interface BatchProgressState {
  total: number;
  completed: number;
  headline: string;
  detail: string;
  finished: boolean;
  cancelRequested: boolean;
  onCancel: () => void;
  render?: () => void;
}
