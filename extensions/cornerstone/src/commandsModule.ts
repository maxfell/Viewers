import {
  getEnabledElement,
  StackViewport,
  VolumeViewport,
  utilities as csUtils,
} from '@cornerstonejs/core';
import {
  ToolGroupManager,
  Enums,
  utilities as cstUtils,
  ReferenceLinesTool,
} from '@cornerstonejs/tools';
import { ServicesManager } from '@ohif/core';
import { ContextMenu } from '@ohif/ui';

import CornerstoneViewportDownloadForm from './utils/CornerstoneViewportDownloadForm';
import callInputDialog from './utils/callInputDialog';
import { setColormap } from './utils/colormap/transferFunctionHelpers';
import toggleMPRHangingProtocol from './utils/mpr/toggleMPRHangingProtocol';
import toggleStackImageSync from './utils/stackSync/toggleStackImageSync';
import defaultContextMenu from './defaultContextMenu';
import { getFirstAnnotationSelected } from './utils/measurementServiceMappings/utils/selection';
import getActiveViewportEnabledElement from './utils/getActiveViewportEnabledElement';

function commandsModule({ servicesManager, commandsManager }) {
  const {
    viewportGridService,
    toolGroupService,
    cineService,
    toolbarService,
    uiDialogService,
    cornerstoneViewportService,
    hangingProtocolService,
    uiNotificationService,
    customizationService,
    measurementService,
  } = (servicesManager as ServicesManager).services;

  const { measurementServiceSource } = this;
  const contextMenuController = new ContextMenu.Controller(
    servicesManager,
    commandsManager
  );

  function _getActiveViewportEnabledElement() {
    return getActiveViewportEnabledElement(viewportGridService);
  }

  function _getToolGroup(toolGroupId) {
    let toolGroupIdToUse = toolGroupId;

    if (!toolGroupIdToUse) {
      // Use the active viewport's tool group if no tool group id is provided
      const enabledElement = _getActiveViewportEnabledElement();

      if (!enabledElement) {
        return;
      }

      const { renderingEngineId, viewportId } = enabledElement;
      const toolGroup = ToolGroupManager.getToolGroupForViewport(
        viewportId,
        renderingEngineId
      );

      if (!toolGroup) {
        console.warn(
          'No tool group found for viewportId:',
          viewportId,
          'and renderingEngineId:',
          renderingEngineId
        );
        return;
      }

      toolGroupIdToUse = toolGroup.id;
    }

    const toolGroup = toolGroupService.getToolGroup(toolGroupIdToUse);
    return toolGroup;
  }

  const actions = {
    /**
     * Show the specified context menu, with viewer specific
     * information in the checkParams used to determine which
     * menus are displayed.
     * See ContextMenuController for definitions of the menu format
     * and checkParams.
     * The checkParams contains:
     *   toolName of the tool currently selected
     *   uid of the annotation selected
     *   value of the annotation object of interest
     *   nearbyToolData for the annotation near the click point (this is often the same as value)
     */
    showViewerContextMenu: options => {
      const viewerElement = _getActiveViewportEnabledElement()?.viewport
        ?.element;

      const optionsToUse = { ...options };
      const { useSelectedAnnotation, nearbyToolData, menuName } = optionsToUse;

      if (menuName) {
        Object.assign(
          optionsToUse,
          customizationService.getModeCustomization(
            menuName,
            defaultContextMenu
          )
        );
      }

      // This code is used to invoke the context menu via keyboard shortcuts
      if (useSelectedAnnotation && !nearbyToolData) {
        const firstAnnotationSelected = getFirstAnnotationSelected(
          viewerElement
        );
        // filter by allowed selected tools from config property (if there is any)
        if (
          !optionsToUse.allowedSelectedTools ||
          optionsToUse.allowedSelectedTools.includes(
            firstAnnotationSelected?.metadata?.toolName
          )
        ) {
          optionsToUse.nearbyToolData = firstAnnotationSelected;
        } else {
          return;
        }
      }

      // TODO - make the checkProps richer by including the study metadata and display set.
      optionsToUse.checkProps = {
        toolName: optionsToUse.nearbyToolData?.metadata?.toolName,
        value: optionsToUse.nearbyToolData,
        uid: optionsToUse.nearbyToolData?.annotationUID,
        nearbyToolData: optionsToUse.nearbyToolData,
      };

      let defaultPointsPosition = [];
      if (options.nearbyToolData) {
        defaultPointsPosition = commandsManager.runCommand(
          'getToolDataActiveCanvasPoints',
          { toolData: optionsToUse.nearbyToolData }
        );
      }

      contextMenuController.showContextMenu(
        optionsToUse,
        viewerElement,
        defaultPointsPosition
      );
    },

    /** Close a context menu currently displayed */
    closeContextMenu: () => {
      contextMenuController.closeContextMenu();
    },

    getNearbyToolData({ nearbyToolData, element, canvasCoordinates }) {
      return (
        nearbyToolData ??
        cstUtils.getAnnotationNearPoint(element, canvasCoordinates)
      );
    },

    // Measurement tool commands:

    /** Delete the given measurement */
    deleteMeasurement: ({ uid }) => {
      if (uid) {
        measurementServiceSource.remove(uid);
      }
    },

    /**
     * Show the measurement labelling input dialog and update the label
     * on the measurement with a response if not cancelled.
     */
    setMeasurementLabel: ({ uid }) => {
      const measurement = measurementService.getMeasurement(uid);

      callInputDialog(
        uiDialogService,
        measurement,
        (label, actionId) => {
          if (actionId === 'cancel') {
            return;
          }

          const updatedMeasurement = Object.assign({}, measurement, {
            label,
          });

          measurementService.update(
            updatedMeasurement.uid,
            updatedMeasurement,
            true
          );
        },
        false
      );
    },

    /**
     *
     * @param props - containing the updates to apply
     * @param props.measurementKey - chooses the measurement key to apply the
     *        code to.  This will typically be finding or site to apply a
     *        finind code or a findingSites code.
     * @param props.code - A coding scheme value from DICOM, including:
     *       * CodeValue - the language independent code, for example '1234'
     *       * CodingSchemeDesignator - the issue of the code value
     *       * CodeMeaning - the text value shown to the user
     *       * ref - a string reference in the form `<designator>:<codeValue>`
     *       * Other fields
     *     Note it is a valid option to remove the finding or site values by
     *     supplying null for the code.
     * @param props.uid - the measurement UID to find it with
     * @param props.label - the text value for the code.  Has NOTHING to do with
     *        the measurement label, which can be set with textLabel
     * @param props.textLabel is the measurement label to apply.  Set to null to
     *            delete.
     *
     * If the measurementKey is `site`, then the code will also be added/replace
     * the 0 element of findingSites.  This behaviour is expected to be enhanced
     * in the future with ability to set other site information.
     */
    updateMeasurement: props => {
      const { code, uid, measurementKey = 'finding', textLabel, label } = props;
      const measurement = measurementService.getMeasurement(uid);
      const updatedMeasurement = {
        ...measurement,
      };
      // Call it textLabel as the label value
      // TODO - remove the label setting when direct rendering of findingSites is enabled
      if (textLabel !== undefined) {
        updatedMeasurement.label = textLabel;
      }
      if (code !== undefined) {
        if (code.ref && !code.CodeValue) {
          const split = code.ref.indexOf(':');
          code.CodeValue = code.ref.substring(split + 1);
          code.CodeMeaning = code.text || label;
          code.CodingSchemeDesignator = code.ref.substring(0, split);
        }
        updatedMeasurement[measurementKey] = code;
        if (measurementKey === 'site') {
          updatedMeasurement.findingSites = code ? [code] : [];
        }
      }
      measurementService.update(
        updatedMeasurement.uid,
        updatedMeasurement,
        true
      );
    },

    // Retrieve value commands
    getActiveViewportEnabledElement: _getActiveViewportEnabledElement,

    setViewportActive: ({ viewportId }) => {
      const viewportInfo = cornerstoneViewportService.getViewportInfo(
        viewportId
      );
      if (!viewportInfo) {
        console.warn('No viewport found for viewportId:', viewportId);
        return;
      }

      const viewportIndex = viewportInfo.getViewportIndex();
      viewportGridService.setActiveViewportIndex(viewportIndex);
    },
    arrowTextCallback: ({ callback, data }) => {
      callInputDialog(uiDialogService, data, callback);
    },
    toggleCine: () => {
      const { viewports } = viewportGridService.getState();
      const { isCineEnabled } = cineService.getState();
      cineService.setIsCineEnabled(!isCineEnabled);
      toolbarService.setButton('Cine', { props: { isActive: !isCineEnabled } });
      viewports.forEach((_, index) =>
        cineService.setCine({ id: index, isPlaying: false })
      );
    },
    setWindowLevel({ window, level, toolGroupId }) {
      // convert to numbers
      const windowWidthNum = Number(window);
      const windowCenterNum = Number(level);

      const { viewportId } = _getActiveViewportEnabledElement();
      const viewportToolGroupId = toolGroupService.getToolGroupForViewport(
        viewportId
      );

      if (toolGroupId && toolGroupId !== viewportToolGroupId) {
        return;
      }

      // get actor from the viewport
      const renderingEngine = cornerstoneViewportService.getRenderingEngine();
      const viewport = renderingEngine.getViewport(viewportId);

      const { lower, upper } = csUtils.windowLevel.toLowHighRange(
        windowWidthNum,
        windowCenterNum
      );

      viewport.setProperties({
        voiRange: {
          upper,
          lower,
        },
      });
      viewport.render();
    },
    setToolActive: ({ toolName, toolGroupId = null }) => {
      if (toolName === 'Crosshairs') {
        const activeViewportToolGroup = _getToolGroup(null);

        if (!activeViewportToolGroup._toolInstances.Crosshairs) {
          uiNotificationService.show({
            title: 'Crosshairs',
            message:
              'You need to be in a MPR view to use Crosshairs. Click on MPR button in the toolbar to activate it.',
            type: 'info',
            duration: 3000,
          });

          throw new Error('Crosshairs tool is not available in this viewport');
        }
      }

      const { viewports } = viewportGridService.getState() || {
        viewports: [],
      };

      const toolGroup = _getToolGroup(toolGroupId);
      const toolGroupViewportIds = toolGroup.getViewportIds();

      // if toolGroup has been destroyed, or its viewports have been removed
      if (!toolGroupViewportIds || !toolGroupViewportIds.length) {
        return;
      }

      const filteredViewports = viewports.filter(viewport => {
        if (!viewport.viewportOptions) {
          return false;
        }

        return toolGroupViewportIds.includes(
          viewport.viewportOptions.viewportId
        );
      });

      if (!filteredViewports.length) {
        return;
      }

      const activeToolName = toolGroup.getActivePrimaryMouseButtonTool();

      if (activeToolName) {
        // Todo: this is a hack to prevent the crosshairs to stick around
        // after another tool is selected. We should find a better way to do this
        if (activeToolName === 'Crosshairs') {
          toolGroup.setToolDisabled(activeToolName);
        } else {
          toolGroup.setToolPassive(activeToolName);
        }
      }
      // Set the new toolName to be active
      toolGroup.setToolActive(toolName, {
        bindings: [
          {
            mouseButton: Enums.MouseBindings.Primary,
          },
        ],
      });
    },
    showDownloadViewportModal: () => {
      const { activeViewportIndex } = viewportGridService.getState();
      const { uiModalService } = servicesManager.services;

      if (uiModalService) {
        uiModalService.show({
          content: CornerstoneViewportDownloadForm,
          title: 'Download High Quality Image',
          contentProps: {
            activeViewportIndex,
            onClose: uiModalService.hide,
            cornerstoneViewportService,
          },
        });
      }
    },
    rotateViewport: ({ rotation }) => {
      const enabledElement = _getActiveViewportEnabledElement();
      if (!enabledElement) {
        return;
      }

      const { viewport } = enabledElement;

      if (viewport instanceof StackViewport) {
        const { rotation: currentRotation } = viewport.getProperties();
        const newRotation = (currentRotation + rotation) % 360;
        viewport.setProperties({ rotation: newRotation });
        viewport.render();
      }
    },
    flipViewportHorizontal: () => {
      const enabledElement = _getActiveViewportEnabledElement();

      if (!enabledElement) {
        return;
      }

      const { viewport } = enabledElement;

      if (viewport instanceof StackViewport) {
        const { flipHorizontal } = viewport.getCamera();
        viewport.setCamera({ flipHorizontal: !flipHorizontal });
        viewport.render();
      }
    },
    flipViewportVertical: () => {
      const enabledElement = _getActiveViewportEnabledElement();

      if (!enabledElement) {
        return;
      }

      const { viewport } = enabledElement;

      if (viewport instanceof StackViewport) {
        const { flipVertical } = viewport.getCamera();
        viewport.setCamera({ flipVertical: !flipVertical });
        viewport.render();
      }
    },
    invertViewport: ({ element }) => {
      let enabledElement;

      if (element === undefined) {
        enabledElement = _getActiveViewportEnabledElement();
      } else {
        enabledElement = element;
      }

      if (!enabledElement) {
        return;
      }

      const { viewport } = enabledElement;

      if (viewport instanceof StackViewport) {
        const { invert } = viewport.getProperties();
        viewport.setProperties({ invert: !invert });
        viewport.render();
      }
    },
    resetViewport: () => {
      const enabledElement = _getActiveViewportEnabledElement();

      if (!enabledElement) {
        return;
      }

      const { viewport } = enabledElement;

      if (viewport instanceof StackViewport) {
        viewport.resetProperties();
        viewport.resetCamera();
      } else {
        // Todo: add reset properties for volume viewport
        viewport.resetCamera();
      }

      viewport.render();
    },
    scaleViewport: ({ direction }) => {
      const enabledElement = _getActiveViewportEnabledElement();
      const scaleFactor = direction > 0 ? 0.9 : 1.1;

      if (!enabledElement) {
        return;
      }
      const { viewport } = enabledElement;

      if (viewport instanceof StackViewport) {
        if (direction) {
          const { parallelScale } = viewport.getCamera();
          viewport.setCamera({ parallelScale: parallelScale * scaleFactor });
          viewport.render();
        } else {
          viewport.resetCamera();
          viewport.render();
        }
      }
    },
    firstImage: () => {
      // Get current active viewport (return if none active)
      const enabledElement = _getActiveViewportEnabledElement();
      if (!enabledElement) {
        return;
      }
      const { viewport } = enabledElement;

      // Check viewport is supported
      if (
        viewport! instanceof StackViewport &&
        viewport! instanceof VolumeViewport
      ) {
        throw new Error('Unsupported viewport type');
      }

      // Set slice to first slice
      const options = { imageIndex: 0 };
      cstUtils.jumpToSlice(viewport.element, options);
    },
    lastImage: () => {
      // Get current active viewport (return if none active)
      const enabledElement = _getActiveViewportEnabledElement();
      if (!enabledElement) {
        return;
      }
      const { viewport } = enabledElement;

      // Get number of slices
      // -> Copied from cornerstone3D jumpToSlice\_getImageSliceData()
      let numberOfSlices = 0;

      if (viewport instanceof StackViewport) {
        numberOfSlices = viewport.getImageIds().length;
      } else if (viewport instanceof VolumeViewport) {
        numberOfSlices = csUtils.getImageSliceDataForVolumeViewport(viewport)
          .numberOfSlices;
      } else {
        throw new Error('Unsupported viewport type');
      }

      // Set slice to last slice
      const options = { imageIndex: numberOfSlices - 1 };
      cstUtils.jumpToSlice(viewport.element, options);
    },
    scroll: ({ direction }) => {
      const enabledElement = _getActiveViewportEnabledElement();

      if (!enabledElement) {
        return;
      }

      const { viewport } = enabledElement;
      const options = { delta: direction };

      cstUtils.scroll(viewport, options);
    },
    setViewportColormap: ({
      viewportIndex,
      displaySetInstanceUID,
      colormap,
      immediate = false,
    }) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewportByIndex(
        viewportIndex
      );

      const actorEntries = viewport.getActors();

      const actorEntry = actorEntries.find(actorEntry => {
        return actorEntry.uid.includes(displaySetInstanceUID);
      });

      const { actor: volumeActor } = actorEntry;

      setColormap(volumeActor, colormap);

      if (immediate) {
        viewport.render();
      }
    },
    incrementActiveViewport: () => {
      const { activeViewportIndex, viewports } = viewportGridService.getState();
      const nextViewportIndex = (activeViewportIndex + 1) % viewports.length;
      viewportGridService.setActiveViewportIndex(nextViewportIndex);
    },
    decrementActiveViewport: () => {
      const { activeViewportIndex, viewports } = viewportGridService.getState();
      const nextViewportIndex =
        (activeViewportIndex - 1 + viewports.length) % viewports.length;
      viewportGridService.setActiveViewportIndex(nextViewportIndex);
    },
    setHangingProtocol: ({ protocolId }) => {
      hangingProtocolService.setProtocol(protocolId);
    },
    toggleMPR: ({ toggledState }) => {
      toggleMPRHangingProtocol({
        toggledState,
        servicesManager,
        getToolGroup: _getToolGroup,
      });
    },
    toggleStackImageSync: ({ toggledState }) => {
      toggleStackImageSync({
        getEnabledElement,
        servicesManager,
        toggledState,
      });
    },
    toggleReferenceLines: ({ toggledState }) => {
      const { activeViewportIndex } = viewportGridService.getState();
      const viewportInfo = cornerstoneViewportService.getViewportInfoByIndex(
        activeViewportIndex
      );

      const viewportId = viewportInfo.getViewportId();
      const toolGroup = toolGroupService.getToolGroupForViewport(viewportId);

      if (!toggledState) {
        toolGroup.setToolDisabled(ReferenceLinesTool.toolName);
      }

      toolGroup.setToolConfiguration(
        ReferenceLinesTool.toolName,
        {
          sourceViewportId: viewportId,
        },
        true // overwrite
      );
      toolGroup.setToolEnabled(ReferenceLinesTool.toolName);
    },
  };

  const definitions = {
    // The command here is to show the viewer context menu, as being the
    // context menu
    showViewerContextMenu: {
      commandFn: actions.showViewerContextMenu,
      storeContexts: [],
      options: {},
    },

    closeContextMenu: {
      commandFn: actions.closeContextMenu,
      storeContexts: [],
      options: {},
    },
    getNearbyToolData: {
      commandFn: actions.getNearbyToolData,
      storeContexts: [],
      options: {},
    },

    deleteMeasurement: {
      commandFn: actions.deleteMeasurement,
      storeContexts: [],
      options: {},
    },
    setMeasurementLabel: {
      commandFn: actions.setMeasurementLabel,
      storeContexts: [],
      options: {},
    },
    setFinding: {
      commandFn: actions.updateMeasurement,
      storeContexts: [],
      options: { measurementKey: 'finding' },
    },
    setSite: {
      commandFn: actions.updateMeasurement,
      storeContexts: [],
      options: { measurementKey: 'site' },
    },

    setWindowLevel: {
      commandFn: actions.setWindowLevel,
      storeContexts: [],
      options: {},
    },
    setToolActive: {
      commandFn: actions.setToolActive,
      storeContexts: [],
      options: {},
    },
    rotateViewportCW: {
      commandFn: actions.rotateViewport,
      storeContexts: [],
      options: { rotation: 90 },
    },
    rotateViewportCCW: {
      commandFn: actions.rotateViewport,
      storeContexts: [],
      options: { rotation: -90 },
    },
    incrementActiveViewport: {
      commandFn: actions.incrementActiveViewport,
      storeContexts: [],
    },
    decrementActiveViewport: {
      commandFn: actions.decrementActiveViewport,
      storeContexts: [],
    },
    flipViewportHorizontal: {
      commandFn: actions.flipViewportHorizontal,
      storeContexts: [],
      options: {},
    },
    flipViewportVertical: {
      commandFn: actions.flipViewportVertical,
      storeContexts: [],
      options: {},
    },
    invertViewport: {
      commandFn: actions.invertViewport,
      storeContexts: [],
      options: {},
    },
    resetViewport: {
      commandFn: actions.resetViewport,
      storeContexts: [],
      options: {},
    },
    scaleUpViewport: {
      commandFn: actions.scaleViewport,
      storeContexts: [],
      options: { direction: 1 },
    },
    scaleDownViewport: {
      commandFn: actions.scaleViewport,
      storeContexts: [],
      options: { direction: -1 },
    },
    fitViewportToWindow: {
      commandFn: actions.scaleViewport,
      storeContexts: [],
      options: { direction: 0 },
    },
    nextImage: {
      commandFn: actions.scroll,
      storeContexts: [],
      options: { direction: 1 },
    },
    previousImage: {
      commandFn: actions.scroll,
      storeContexts: [],
      options: { direction: -1 },
    },
    firstImage: {
      commandFn: actions.firstImage,
      storeContexts: [],
      options: {},
    },
    lastImage: {
      commandFn: actions.lastImage,
      storeContexts: [],
      options: {},
    },
    showDownloadViewportModal: {
      commandFn: actions.showDownloadViewportModal,
      storeContexts: [],
      options: {},
    },
    toggleCine: {
      commandFn: actions.toggleCine,
      storeContexts: [],
      options: {},
    },
    arrowTextCallback: {
      commandFn: actions.arrowTextCallback,
      storeContexts: [],
      options: {},
    },
    setViewportActive: {
      commandFn: actions.setViewportActive,
      storeContexts: [],
      options: {},
    },
    setViewportColormap: {
      commandFn: actions.setViewportColormap,
      storeContexts: [],
      options: {},
    },
    setHangingProtocol: {
      commandFn: actions.setHangingProtocol,
      storeContexts: [],
      options: {},
    },
    toggleMPR: {
      commandFn: actions.toggleMPR,
      storeContexts: [],
      options: {},
    },
    toggleStackImageSync: {
      commandFn: actions.toggleStackImageSync,
      storeContexts: [],
      options: {},
    },
    toggleReferenceLines: {
      commandFn: actions.toggleReferenceLines,
      storeContexts: [],
      options: {},
    },
  };

  return {
    actions,
    definitions,
    defaultContext: 'CORNERSTONE',
  };
}

export default commandsModule;
