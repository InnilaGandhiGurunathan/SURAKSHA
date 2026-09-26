/** Browser-facing re-export. The implementation lives in `api/` so the Vercel function can bundle it. */
export {
  MAPS_CONFIG_PATH,
  MAPS_ID_ENV_NAMES,
  MAPS_KEY_ENV_NAMES,
  normalizeMapsCredential,
  readMapsConfigFromEnv,
  type EnvLike,
  type MapsHostConfig,
} from '../../api/mapsHostEnv';
