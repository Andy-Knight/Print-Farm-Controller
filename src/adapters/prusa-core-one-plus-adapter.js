import {
  PrusaLinkAdapter,
  createPrusaLinkAdapterDefinition,
  preparePrusaLinkConfig
} from './prusa-link-adapter.js';
import {
  PRUSA_CORE_ONE_PLUS_PROFILE,
  prusaLinkToolConfiguration
} from './prusa-link-models.js';

export const PRUSA_CORE_ONE_PLUS_ADAPTER_TYPE = PRUSA_CORE_ONE_PLUS_PROFILE.adapterType;
export const PRUSA_CORE_ONE_PLUS_TOOL_COUNTS = Object.freeze(
  PRUSA_CORE_ONE_PLUS_PROFILE.toolConfigurations.map((item) => item.count)
);

export function preparePrusaCoreOnePlusConfig(input = {}) {
  return preparePrusaLinkConfig(PRUSA_CORE_ONE_PLUS_PROFILE, input);
}

export class PrusaCoreOnePlusAdapter extends PrusaLinkAdapter {
  constructor(printer) {
    super(printer, PRUSA_CORE_ONE_PLUS_PROFILE);
  }

  get toolConfiguration() {
    return prusaLinkToolConfiguration(
      PRUSA_CORE_ONE_PLUS_PROFILE,
      this.printer?.adapterConfig?.toolCount ?? PRUSA_CORE_ONE_PLUS_PROFILE.defaultToolCount
    );
  }
}

export const prusaCoreOnePlusAdapterDefinition = createPrusaLinkAdapterDefinition(
  PRUSA_CORE_ONE_PLUS_PROFILE,
  { AdapterClass:PrusaCoreOnePlusAdapter }
);
