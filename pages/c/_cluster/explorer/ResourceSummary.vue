<script>
import SimpleBox from '@/components/SimpleBox';
import { NAME as VIRTUAL } from '@/config/product/explorer';

export function colorToCountName(color) {
  switch (color) {
  case 'text-success':
  case 'text-info':
    return 'useful';
  case 'text-warning':
    return 'warningCount';
  default:
    return 'errorCount';
  }
}

export function resourceCounts(store, resource) {
  const inStore = store.getters['currentProduct'].inStore;
  // const clusterCounts = store.getters[`${ inStore }/all`](resource)[0].counts;
  // const summary = clusterCounts[resource].summary;

  const resourceAll = store.getters[`${ inStore }/all`](resource);

  const warningCount = resourceAll?.[0]?.warningCount || 0;
  const errorCount = resourceAll?.[0]?.errorCount || 0;

  const counts = {
    total:        resourceAll.length || 0,
    useful:       resourceAll.length || 0,
    warningCount,
    errorCount
  };

  // Object.entries(summary.states || {}).forEach((entry) => {
  //   const color = colorForState(entry[0]);
  //   const count = entry[1];
  //   const countName = colorToCountName(color);

  //   counts['useful'] -= count;
  //   counts[countName] += count;
  // });
  counts['useful'] -= warningCount;
  counts['useful'] -= errorCount;

  return counts;
}

export default {
  components: { SimpleBox },

  props:      {
    resource: {
      type:     String,
      default: ''
    },

    spoofedCounts: {
      type:    Object,
      default: null
    }
  },

  computed: {
    resourceCounts() {
      if (this.spoofedCounts) {
        return this.spoofedCounts;
      }

      return resourceCounts(this.$store, this.resource);
    },

    location() {
      if (this.spoofedCounts) {
        return this.spoofedCounts.location;
      }

      return {
        name:     'c-cluster-product-resource',
        params:   { product: VIRTUAL, resource: this.resource }
      };
    },

    name() {
      if (this.spoofedCounts) {
        return this.spoofedCounts.name;
      }
      const inStore = this.$store.getters['currentProduct'].inStore;
      const schema = this.$store.getters[`${ inStore }/schemaFor`](this.resource);

      return this.$store.getters['type-map/labelFor'](schema, this.resourceCounts.useful);
    },
  },

  methods: {
    goToResource() {
      if (this.location) {
        this.$router.push(this.location);
      }
    },
  }

};
</script>

<template>
  <div>
    <SimpleBox class="container" :class="{'has-link': !!location}" @click="goToResource">
      <h1>{{ resourceCounts.useful }}</h1>
      <h3>
        {{ name }}
      </h3>
      <div class="warnings">
        <div v-if="resourceCounts.warningCount" class="warn-count mb-10 chip">
          {{ resourceCounts.warningCount }}
        </div>
        <div v-if="resourceCounts.errorCount" class="error-count chip">
          {{ resourceCounts.errorCount }}
        </div>
      </div>
    </SimpleBox>
  </div>
</template>

<style lang='scss' scoped>
  .has-link {
    cursor: pointer;

    &:hover {
      border-color: var(--link-text);
    }
  }

  ::v-deep .content{
    display: flex;
    justify-content: space-between;
    align-items: center;
    & H1, H3 {
        margin: 0;
    }

    & .chip{
      border-radius: 2em;
      color: var(--body-bg);
      padding: 0px 1em;

      &.warn-count {
          background: var(--warning)
      }

      &.error-count {
          background: var(--error)
      }
    }
}
</style>
