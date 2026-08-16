export type RecommendationState = 'new' | 'presented' | 'selected' | 'suitable' | 'rejected' | 'unsuitable' | 'satisfied' | 'unsatisfied' | 'not_worn';

export type RecommendationEventType =
  | 'impression'
  | 'skipped'
  | 'selected_for_wear'
  | 'marked_suitable'
  | 'marked_unsuitable'
  | 'worn_satisfied'
  | 'worn_unsatisfied'
  | 'not_worn';

const terminalStates = new Set<RecommendationState>(['rejected', 'unsuitable', 'satisfied', 'unsatisfied', 'not_worn']);

export function isRecommendationEventType(value: unknown): value is RecommendationEventType {
  return typeof value === 'string' && [
    'impression',
    'skipped',
    'selected_for_wear',
    'marked_suitable',
    'marked_unsuitable',
    'worn_satisfied',
    'worn_unsatisfied',
    'not_worn',
  ].includes(value);
}

export function applyRecommendationEvent(current: RecommendationState, event: RecommendationEventType): RecommendationState {
  if (terminalStates.has(current)) throw new Error('terminal recommendation state cannot accept another event');
  if (event === 'impression') return 'presented';
  if (event === 'skipped') return current === 'new' ? 'presented' : current;
  if (event === 'selected_for_wear') {
    if (current !== 'new' && current !== 'presented' && current !== 'suitable') throw new Error('recommendation must be presented before selection');
    return 'selected';
  }
  if (event === 'marked_suitable') {
    if (current !== 'new' && current !== 'presented' && current !== 'selected') throw new Error('recommendation must be presented before fit feedback');
    return 'suitable';
  }
  if (event === 'marked_unsuitable') {
    if (current !== 'new' && current !== 'presented') throw new Error('recommendation must be presented before rejection');
    return 'unsuitable';
  }
  if (current !== 'presented' && current !== 'selected' && current !== 'suitable') throw new Error('wear outcome must be presented or selected');
  if (event === 'worn_satisfied') return 'satisfied';
  if (event === 'worn_unsatisfied') return 'unsatisfied';
  return 'not_worn';
}

export function normalizeRecommendationEvent(value: unknown) {
  if (!isRecommendationEventType(value)) throw new Error('unknown recommendation event');
  return value;
}
