/**
 * Where the community lives inside the site.
 *
 * Every internal link goes through here. These used to be bare `/p/12` paths,
 * correct only while the section was a separate app mounted at its own router
 * basename; inside the site they would land on the catalog. Deriving them from
 * one constant means the section can be remounted by editing one line.
 */
export const COMMUNITY_PATH = '/community'

export const communityHome = COMMUNITY_PATH
export const communityRules = `${COMMUNITY_PATH}/about`
export const postPath = (id: number): string => `${COMMUNITY_PATH}/p/${id}`
export const profilePath = (login: string): string =>
  `${COMMUNITY_PATH}/u/${encodeURIComponent(login)}`
