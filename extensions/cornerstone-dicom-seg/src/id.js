import packageJson from '../package.json';

const id = packageJson.name;
const SOPClassHandlerName = 'dicom-seg';
const SOPClassHandlerId = `${id}.sopClassHandlerModule.${SOPClassHandlerName}`;
const SEG_TOOLGROUP_DEFAULT = 'SEGToolGroup';

export { id, SOPClassHandlerId, SOPClassHandlerName, SEG_TOOLGROUP_DEFAULT };
