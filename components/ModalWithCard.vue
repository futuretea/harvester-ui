<script>
import Card from '@/components/Card';
import Banner from '@/components/Banner';
import AsyncButton from '@/components/AsyncButton';

export default {
  name: 'ModalWithCard',

  components: {
    Card, Banner, AsyncButton
  },

  props:      {
    name: {
      type:     String,
      required: true
    },

    closeText: {
      type:    String,
      default: 'Close'
    },

    saveText: {
      type:    String,
      default: 'create'
    },

    width: {
      type:    [String, Number],
      default: '50%'
    },

    height: {
      type:    [String, Number],
      default: 'auto'
    },

    errors: {
      type:    Array,
      default: () => {
        return [];
      }
    }
  },

  methods: {
    hide() {
      this.$modal.hide(this.name);
    },

    open() {
      this.$modal.show(this.name);
    },
  }
};

</script>

<template>
  <modal
    :name="name"
    :width="width"
    :click-to-close="false"
    :height="height"
    v-bind="$attrs"
    styles="background-color: var(--nav-bg); border-radius: var(--border-radius); max-height: 100vh;"
  >
    <Card class="modal" :show-highlight-border="false">
      <template #title>
        <h4 slot="title" class="text-default-text">
          <slot name="title"></slot>
        </h4>
      </template>

      <template #body>
        <slot name="content"></slot>

        <div v-for="(err,idx) in errors" :key="idx">
          <Banner class="banner" color="error" :label="err" />
        </div>
      </template>

      <template #actions>
        <slot name="footer">
          <div class="footer">
            <button v-if="$listeners['close']" class="btn role-secondary mr-20" @click="$emit('close', $event)">
              {{ closeText }}
            </button>

            <button v-else class="btn btn-sm role-secondary mr-10" @click="close">
              {{ t('generic.close') }}
            </button>

            <AsyncButton
              :mode="saveText"
              @click="$emit('finish', $event)"
            />
          </div>
        </slot>
      </template>
    </Card>
  </modal>
</template>

<style lang="scss" scoped>
.footer {
  width: 100%;
  display: flex;
  justify-content: center;
}

.banner {
  margin-bottom: 0px;
}
</style>

<style lang="scss">
.modal {
  &.card-container {
    box-shadow: none;
  }
}
</style>
