<script setup lang="ts">
  import { storeToRefs } from 'pinia';
  import ModalOverlay from "components/ModalOverlay.vue";
  import {ref, Ref, computed} from 'vue';
  import {useVolumesStore, useLayersStore} from '../store';
  const volumeStore = useVolumesStore();
  const layerStore = useLayersStore();

  const {activeLayers, selectLayers} = layerStore;

  const emit = defineEmits({
    hide: null,
  });


  const activeVolumes = computed(() => {
    const res: Set<string> = new Set();
    for (const volume of volumes) {
      for (const image_layer of volume.image_layers) {
        for (const layer of activeLayers) {
          if (image_layer.source === layer) {
            res.add(volume.name);
          }
        }
      }
      for (const segmentation_layer of volume.segmentation_layers) {
        for (const layer of activeLayers) {
          if (segmentation_layer.source === layer) {
            res.add(volume.name);
          }
        }
      }
    }
    return res;
  });

  storeToRefs;

  const volumes = volumeStore.volumes;

  const selectedVolumeName: Ref<string|undefined> = ref(undefined);
  const selectedImageSource: Ref<string|undefined> = ref(undefined);
  const selectedSegmentationSource: Ref<string|undefined> = ref(undefined);
  const selectedVolume = computed(() => {
    for (const volume of volumes) {
      if (volume.name === selectedVolumeName.value) {
        return volume;
      }
    }
    return undefined;
  });
  const selectedImageLayer = computed(() => {
    const volume = selectedVolume.value;
    if (volume) {
      for (const layer of volume.image_layers) {
        if (layer.source === selectedImageSource.value) {
          return layer;
        }
      }
    }
    return undefined;
  });
  const selectedSegmentationLayer = computed(() => {
    const volume = selectedVolume.value;
    if (volume) {
      for (const layer of volume.segmentation_layers) {
        if (layer.source === selectedSegmentationSource.value) {
          return layer;
        }
      }
    }
    return undefined;
  });
  function selectVolume(name: string) {
    selectedVolumeName.value = name;
    const volume = selectedVolume.value;
    let defaultSelectedImage: string|undefined = undefined;
    let defaultSelectedSegmentation: string|undefined = undefined;
    if (volume) {
      for (const layer of volume.image_layers.slice().reverse()) {
        defaultSelectedImage = layer.source;
        if (activeLayers.has(layer.source)) {
          break;
        }
      }
      for (const layer of volume.segmentation_layers.slice().reverse()) {
        defaultSelectedSegmentation = layer.source;
        if (activeLayers.has(layer.source)) {
          break;
        }
      }
    }
    selectedImageSource.value = defaultSelectedImage;
    selectedSegmentationSource.value = defaultSelectedSegmentation;
  }
  const canConfirm = computed(() => {
    return selectedSegmentationLayer.value !== undefined
      && selectedImageLayer.value !== undefined
      && (!(activeLayers.has(selectedImageLayer.value.source))
      || !(activeLayers.has(selectedSegmentationLayer.value.source)));
  });
  function confirmSelection() {
    if (canConfirm.value) {
      const layers = [selectedImageLayer.value, selectedSegmentationLayer.value].map(x => {
        const {source, ngl_image_name, name, type} = x!;
        const [first, ...rest] = source.split('://');
        // TEMP
        const sourceWithCredentials = source.startsWith('graphene') ? `${first}://middleauth+${rest.join('://')}` : source;
        return {
          name: ngl_image_name || name,
          source: sourceWithCredentials,
          type,
          tab: 'source'
        }
      });
    selectLayers(layers);
    emit('hide');
  }
}
</script>

<template>
  <modal-overlay v-if="volumes.length" class="volumeSelector" @hide="emit('hide')">
      <button class="exit" @click="emit('hide')">×</button>
        <div class="content selectedVolume" v-if="selectedVolume">
          <div class="header">
            <button class="back" @click="selectedVolumeName = undefined"><span class="material-symbols-outlined">arrow_back</span></button>
            <div class="title">{{ selectedVolume.name }}</div>
          </div>
          <div class="volume">
            <div class="layerSplit">
              <div class="layers">
                <div>Select Image Source</div>
                <div v-for="layer of selectedVolume.image_layers"
                    @click="selectedImageSource = layer.source"
                    :class="{ selected: layer.source === selectedImageLayer?.source,
                              active: activeLayers.has(layer.source) }">
                  <div>{{ layer.name }}</div>
                  <div class="description">{{ layer.description }}</div>
                </div>
              </div>
              <div class="layers">
                <div>Select Segmentation</div>
                <div v-for="layer of selectedVolume.segmentation_layers"
                    @click="selectedSegmentationSource = layer.source"
                    :class="{ selected: layer.source === selectedSegmentationLayer?.source,
                              active: activeLayers.has(layer.source) }">
                  <div>{{ layer.name }}</div>
                  <div class="description">{{ layer.description }}</div>
                </div>
              </div>
            </div>
          </div>
          <button :disabled="!canConfirm" class="confirmSelection fill test" @click="confirmSelection()">Confirm</button>
        </div>
        <div class="content" v-else>
            <div class="header"><div class="title">Available Volumes</div></div>
            <ul class="volumes">
              <li v-for="volume of volumes" @click="selectVolume(volume.name)">
                <div :class="{ selected: volume.name === selectedVolumeName,
                               active: activeVolumes.has(volume.name)}">
                  <div>{{ volume.name }}</div>
                  <div class="description">{{ volume.description }}</div>
                  <div class="layerSplit">
                    <div class="layers">
                      <div v-for="layer of volume.image_layers">{{ layer.name }}</div>
                    </div>
                    <div class="layers">
                      <div v-for="layer of volume.segmentation_layers">{{ layer.name }}</div>
                    </div>
                  </div>
                </div>
              </li>
            </ul>
      </div>
    </modal-overlay>
</template>

<style scoped>
.header {
  font-size: 16px;
}

.selectedVolume .confirmSelection {
  justify-self: end;
}

.back {
  grid-row: 1;
  grid-column: 1;
  z-index: 1;
  cursor: pointer;
}

.exit {
  position: absolute;
  right: 5px;
  width: 22px;
}

.ng-extend .volumeSelector button:not(.fill) {
  opacity: 0.75;
}

.ng-extend .volumeSelector button:not(.fill):hover {
  background-color: initial;
  opacity: 1;
}

.content {
  max-width: 60vw;
  display: grid;
  gap: 10px;
}

.darkModal {
  /* background-color: --color-medium-bg; */
  padding: 50px;
  border-radius: 10px;
}

.volumes {
  display: grid;
  grid-gap: 5px;
  max-height: 75vh;
  overflow-y: auto;
}

.volumes > li > div {
  border: 1px solid hsl(0 0% 25% / 1);
  border-radius: 5px;
  padding: 20px;
  cursor: pointer;
  display: grid;
  gap: 5px;
}

.volumes > li > div:hover:not(.active) {
  background-color:  hsl(0 0% 20% / 1);
}

.volumes .layers, .description {
  font-size: 14px;
  opacity: 0.5;
}

.layerSplit {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-gap: 5px;
}

.volumeSelector .header {
  display: grid;
  grid-template-columns: min-content auto;
}

.volumeSelector > .header > div {
  grid-row: 1;
}

.header .title {
  /* text-align: center; */
  display: grid;
  grid-row: 1;
  grid-column: 1/3;
  justify-content: center;
  align-content: center;
}

.volume .layers {
  display: grid;
  grid-gap: 5px;
  grid-auto-rows: min-content;
}

.volume .layers > div {
  padding: 5px;
  border: 1px solid hsl(0 0% 25% / 1);
  border-radius: 5px;
  cursor: pointer;
}

.volume .layers > div:hover {
  background-color:  hsl(0 0% 20% / 1);
}

.volume .layers > div:first-child {
  border: none;
  cursor: inherit;
  background: none;
}

.volume .layers > div.selected {
  border: 1px solid hsl(0 0% 100% / 1);
}

.volume .layers > div:not(.active).selected {
  background-color:  hsl(0 0% 20% / 1);
}

.volumeSelector div.active {
  background: var(--color-ng-selected-faint);
}

.volumeSelector div.active:hover {
  background: var(--color-ng-selected-less-faint);
}

.volumeSelector div.active:not(.selected) {
  border: 1px solid var(--color-ng-selected);
}

.volume .description {
  max-width: 400px;
}

.volume .layers {
  opacity: 1;
}

</style>../store