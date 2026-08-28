/**
 * Farm and plot option lists.
 *
 * Built from the domain constants rather than typed out, so a value added to the vocabulary
 * appears on the form automatically — and, more usefully, a value REMOVED cannot linger on a
 * screen still offering it.
 */

import {
  FARMING_METHODS,
  IRRIGATION_METHODS,
  LAND_OWNERSHIP_TYPES,
  LAND_UNITS,
  SOIL_TYPES,
  WATER_SOURCES,
} from '@langgol/domain/farming'
import type { MessageKey, Translator } from '@langgol/i18n'

export interface Option {
  readonly value: string
  readonly label: string
}

const options = (t: Translator, section: string, prefix: string, values: readonly string[]) =>
  values.map((value) => ({ value, label: t.t(`${section}.${prefix}${value}` as MessageKey) }))

/** Soil labels live under `farm.`; every other vocabulary is shared with the P5 questionnaire. */
export const holdingOptions = (t: Translator) => ({
  units: options(t, 'farmer', 'unit', LAND_UNITS),
  soils: options(t, 'farm', 'soil', SOIL_TYPES),
  ownerships: options(t, 'farmer', 'ownership', LAND_OWNERSHIP_TYPES),
  irrigationMethods: options(t, 'farmer', 'irrigation', IRRIGATION_METHODS),
  waterSources: options(t, 'farmer', 'water', WATER_SOURCES),
  farmingMethods: options(t, 'farmer', 'method', FARMING_METHODS),
})

export const holdingLabels = (t: Translator, submit: string) => ({
  name: t.t('farm.farmName'),
  nameHint: t.t('farm.farmNameHint'),
  area: t.t('farm.area'),
  areaUnit: t.t('farm.areaUnit'),
  soil: t.t('farm.soil'),
  ownership: t.t('farm.ownership'),
  irrigation: t.t('farm.irrigation'),
  irrigationYes: t.t('farm.irrigationYes'),
  irrigationNo: t.t('farm.irrigationNo'),
  irrigationMethod: t.t('farm.irrigationMethod'),
  waterSource: t.t('farm.waterSource'),
  method: t.t('farm.method'),
  notAnswered: t.t('farm.notAnswered'),
  optionalNote: t.t('farm.optionalNote'),
  submit,
  loading: t.t('common.loading'),
  saved: t.t('farm.saved'),
  errorName: t.t('errors.nameEmpty'),
  errorArea: t.t('errors.landInvalid'),
  errorIrrigation: t.t('errors.irrigationInconsistent'),
  errorNotFound: t.t('errors.notFound'),
  errorNotAllowed: t.t('errors.notAllowed'),
  errorLimit: t.t('errors.addressLimit'),
  errorUnexpected: t.t('errors.unexpected'),
})
