import { ColorObject, ColorPickerChangeTrigger } from './type';

// color modes
export type TdColorModes = 'monochrome' | 'linear-gradient' | 'radial-gradient';

// color context
export interface TdColorContext {
  color: ColorObject;
  trigger: ColorPickerChangeTrigger;
}
