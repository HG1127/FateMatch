/** Free preview filesystems are transient: block new media writes instead of falsely promising persistence. */
export function mayStoreUpload(env) {
  return !(env.STAGING_MODE === '1' && env.SUIYUAN_EPHEMERAL_PREVIEW === '1')
}
