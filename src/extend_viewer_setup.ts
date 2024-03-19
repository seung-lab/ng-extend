//copy and pasted code but like withpout the default part because this is the best way I can do this
//because viewer setup is hard coded to default viewer and I don't know if there's a clever way to 
//take prio away from the default Viewer


import 'neuroglancer/ui/default_viewer.css';
import {Viewer} from 'neuroglancer/viewer';
import {setDefaultInputEventBindings} from 'neuroglancer/ui/default_input_event_bindings';
import {bindDefaultCopyHandler, bindDefaultPasteHandler} from 'neuroglancer/ui/default_clipboard_handling';
import {StatusMessage} from 'neuroglancer/status';
import 'neuroglancer/sliceview/chunk_format_handlers';
import {UrlHashBinding} from "neuroglancer/ui/url_hash_binding";
import {bindTitle} from "neuroglancer/ui/title";
import {UserLayer, UserLayerConstructor, layerTypes} from "neuroglancer/layer";
import {Tool, restoreTool} from 'neuroglancer/ui/tool';
import {verifyObject, verifyObjectProperty, verifyString} from 'neuroglancer/util/json';

declare var NEUROGLANCER_DEFAULT_STATE_FRAGMENT: string|undefined;

type CustomBinding = {
    layer: string, tool: unknown, provider?: string,
  }
  
  type CustomBindings = {
    [key: string]: CustomBinding|string
  };
  
declare const CUSTOM_BINDINGS: CustomBindings|undefined;
export const hasCustomBindings = typeof CUSTOM_BINDINGS !== 'undefined' && Object.keys(CUSTOM_BINDINGS).length > 0;

//this is literally copy pasted from default_viewer_setup with the only change being that it takes in a viewer instead of creating one itself
export function setupParentViewer(viewer : Viewer) {
    
    setDefaultInputEventBindings(viewer.inputEventBindings);
  
    const bindNonLayerSpecificTool = (obj: unknown, toolKey: string, desiredLayerType: UserLayerConstructor, desiredProvider?: string) => {
      let previousTool: Tool<Object>|undefined;
      let previousLayer: UserLayer|undefined;
      if (typeof obj === 'string') {
        obj = {'type': obj};
      }
      verifyObject(obj);
      const type = verifyObjectProperty(obj, 'type', verifyString);
      viewer.bindAction(`tool-${type}`, () => {
        const acceptableLayers = viewer.layerManager.managedLayers.filter((managedLayer) => {
          const correctLayerType = managedLayer.layer instanceof desiredLayerType;
          if (desiredProvider && correctLayerType) {
            for (const dataSource of managedLayer.layer?.dataSources || []) {
              const protocol = viewer.dataSourceProvider.getProvider(dataSource.spec.url)[2];
              if (protocol === desiredProvider) {
                return true;
              }
            }
            return false;
          } else {
            return correctLayerType;
          }
        });
        if (acceptableLayers.length > 0) {
          const firstLayer = acceptableLayers[0].layer;
          if (firstLayer) {
            if (firstLayer !== previousLayer) {
              previousTool = restoreTool(firstLayer, obj);
              previousLayer = firstLayer;
            }
            if (previousTool) {
              viewer.activateTool(toolKey, previousTool);
            }
          }
        }
      });
    }
  
    if (hasCustomBindings) {
      for (const [key, val] of Object.entries(CUSTOM_BINDINGS!)) {
        if (typeof val === 'string') {
          viewer.inputEventBindings.global.set(key, val);
        } else {
          viewer.inputEventBindings.global.set(key, `tool-${val.tool}`);
          const layerConstructor = layerTypes.get(val.layer);
          if (layerConstructor) {
            const toolKey = key.charAt(key.length - 1).toUpperCase();
            bindNonLayerSpecificTool(val.tool, toolKey, layerConstructor, val.provider);
          }
        }
      }
    }
  
    const hashBinding = viewer.registerDisposer(
        new UrlHashBinding(viewer.state, viewer.dataSourceProvider.credentialsManager, {
          defaultFragment: typeof NEUROGLANCER_DEFAULT_STATE_FRAGMENT !== 'undefined' ?
              NEUROGLANCER_DEFAULT_STATE_FRAGMENT :
              undefined
        }));
    viewer.registerDisposer(hashBinding.parseError.changed.add(() => {
      const {value} = hashBinding.parseError;
      if (value !== undefined) {
        const status = new StatusMessage();
        status.setErrorMessage(`Error parsing state: ${value.message}`);
        console.log('Error parsing state', value);
      }
      hashBinding.parseError;
    }));
    hashBinding.updateFromUrlHash();
    viewer.registerDisposer(bindTitle(viewer.title));
  
    bindDefaultCopyHandler(viewer);
    bindDefaultPasteHandler(viewer);
  
    return viewer;
  }