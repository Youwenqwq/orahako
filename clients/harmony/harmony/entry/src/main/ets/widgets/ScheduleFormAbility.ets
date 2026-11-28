import { Want } from '@kit.AbilityKit';
import { FormExtensionAbility, formBindingData, formInfo } from '@kit.FormKit';
import { isWidgetPreview, refreshWidget } from './ScheduleWidget';
import { buildExamBinding, buildExamPreview, EXAM_FORM_NAME } from './ExamWidgetData';
import { buildScheduleBinding, buildSchedulePreview, SCHEDULE_FORM_NAME } from './ScheduleWidgetData';

export default class ScheduleFormAbility extends FormExtensionAbility {
  onAddForm(want: Want): formBindingData.FormBindingData {
    const params = want.parameters;
    const id = params?.[formInfo.FormParam.IDENTITY_KEY];
    const name = params?.[formInfo.FormParam.NAME_KEY];
    const compact = Number(params?.[formInfo.FormParam.DIMENSION_KEY]) === formInfo.FormDimension.Dimension_2_2;
    const location = Number(params?.[formInfo.FormParam.FORM_LOCATION_KEY]);
    const preview = params?.[formInfo.FormParam.TEMPORARY_KEY] === true || isWidgetPreview(location);
    if (!preview && typeof id === 'string') {
      const knownDesktop = location === formInfo.FormLocation.DESKTOP &&
        (name === SCHEDULE_FORM_NAME || name === EXAM_FORM_NAME);
      void refreshWidget(id, knownDesktop ? name as string : undefined, knownDesktop ? compact : undefined)
        .catch(() => {});
    }
    const data = name === EXAM_FORM_NAME ?
      JSON.stringify(preview ? buildExamPreview(compact) : buildExamBinding(null, compact)) :
      JSON.stringify(preview ? buildSchedulePreview(compact) : buildScheduleBinding(null, compact));
    return formBindingData.createFormBindingData(data);
  }

  onCastToNormalForm(formId: string): void {
    void refreshWidget(formId).catch(() => {});
  }

  onUpdateForm(formId: string): void {
    void refreshWidget(formId).catch(() => {});
  }
}
