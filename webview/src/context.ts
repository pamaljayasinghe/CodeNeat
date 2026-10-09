import type { DashboardState, SettingsDraft } from '../../src/shared/types';
import type { LanguageView, PageId, Scope, Target } from './state';

/** Everything a dashboard page needs: the host snapshot, the editable draft and the current selection. */
export interface PageContext {
  state: DashboardState;
  draft: SettingsDraft;
  update(change: (draft: SettingsDraft) => SettingsDraft): void;
  scope: Scope;
  target: Target;
  languageId: string;
  view: LanguageView | undefined;
  navigate(page: PageId): void;
  selectLanguage(languageId: string): void;
  /** Human description of where edits are stored, e.g. "your settings for Python". */
  slotLabel: string;
}
