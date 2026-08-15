/**
 * Typed view of the static popup DOM.
 *
 * The popup has many ordinary elements addressed by id, but audio controls need
 * stronger types (`value`, `checked`, canvas APIs, etc.). Keep those contracts in
 * one place so a markup refactor fails immediately instead of surfacing later as
 * an undefined-property error in an event handler.
 */
export interface PopupElements extends Record<string, HTMLElement> {
  eqCanvas: HTMLCanvasElement;

  gainSlider: HTMLInputElement;
  dynamicsEnabled: HTMLInputElement;
  dynamicsAmount: HTMLInputElement;
  dynamicsResponse: HTMLInputElement;
  lowCrossover: HTMLInputElement;
  highCrossover: HTMLInputElement;
  stereoEnabled: HTMLInputElement;
  stereoWidth: HTMLInputElement;
  stereoBalance: HTMLInputElement;
  pitchEnabled: HTMLInputElement;
  pitchSemitones: HTMLInputElement;
  reverbEnabled: HTMLInputElement;
  reverbMix: HTMLInputElement;
  autoPanEnabled: HTMLInputElement;
  autoPanRate: HTMLInputElement;
  autoPanDepth: HTMLInputElement;

  bandFrequency: HTMLInputElement;
  bandGain: HTMLInputElement;
  bandQ: HTMLInputElement;

  presetName: HTMLInputElement;
  presetSelect: HTMLSelectElement;
  importFile: HTMLInputElement;
  artworkFile: HTMLInputElement;
  backgroundFile: HTMLInputElement;
  themeImportFile: HTMLInputElement;

  gainResetButton: HTMLButtonElement;
  spectrumFreezeButton: HTMLButtonElement;
  powerToggle: HTMLButtonElement;
  updatePresetButton: HTMLButtonElement;
  duplicatePresetButton: HTMLButtonElement;
  renamePresetButton: HTMLButtonElement;
  deletePresetButton: HTMLButtonElement;
  artworkUploadButton: HTMLButtonElement;
  backgroundUploadButton: HTMLButtonElement;
  surfaceResetButton: HTMLButtonElement;
}

const INPUT_IDS = [
  'gainSlider','dynamicsEnabled','dynamicsAmount','dynamicsResponse','lowCrossover','highCrossover',
  'stereoEnabled','stereoWidth','stereoBalance','pitchEnabled','pitchSemitones','reverbEnabled','reverbMix',
  'autoPanEnabled','autoPanRate','autoPanDepth','bandFrequency','bandGain','bandQ','presetName','importFile',
  'artworkFile','backgroundFile','themeImportFile'
] as const;

const BUTTON_IDS = [
  'gainResetButton','spectrumFreezeButton','powerToggle','updatePresetButton','duplicatePresetButton',
  'renamePresetButton','deletePresetButton','artworkUploadButton','backgroundUploadButton','surfaceResetButton'
] as const;

function requiredElement<T extends HTMLElement>(root: ParentNode, id: string, tagName: string): T {
  const element = root.querySelector<HTMLElement>(`#${id}`);
  if (!element || element.tagName !== tagName) throw new Error(`Popup markup contract failed: #${id} must be <${tagName.toLowerCase()}>.`);
  return element as T;
}

export function collectPopupElements(root: ParentNode = document): PopupElements {
  const all: Record<string, HTMLElement> = {};
  for (const element of root.querySelectorAll<HTMLElement>('[id]')) all[element.id] = element;

  const typed: Record<string, HTMLElement> = { ...all };
  for (const id of INPUT_IDS) typed[id] = requiredElement<HTMLInputElement>(root, id, 'INPUT');
  for (const id of BUTTON_IDS) typed[id] = requiredElement<HTMLButtonElement>(root, id, 'BUTTON');
  typed.eqCanvas = requiredElement<HTMLCanvasElement>(root, 'eqCanvas', 'CANVAS');
  typed.presetSelect = requiredElement<HTMLSelectElement>(root, 'presetSelect', 'SELECT');
  return typed as PopupElements;
}
