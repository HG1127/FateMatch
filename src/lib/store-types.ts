import type { FestTemplate } from './festivals'
import type { LocalAccount } from './localAuth'

export type Gender = 'male' | 'female' | 'unknown'

export interface Verification {
  phone: boolean
  realname: boolean
  photo: boolean
}

export interface User {
  id: string
  phone: string
  password: string
  nickname: string
  gender: Gender
  seeking: Gender
  birthDate: string
  city: string
  region?: string
  height: number
  job: string
  bio: string
  interests: string[]
  photos: string[]
  verification: Verification
  badgeDates?: Record<string, number>
  createdAt: number
  stealth?: boolean
  role?: 'admin'
  banned?: boolean
}

export interface ChatMsg {
  id: string
  from: string
  text: string
  at: number
  read?: boolean
  recalled?: boolean
  image?: string
  images?: string[]
}

export interface ConversationSummary {
  otherId: string
  lastAt: number
  lastText: string
  lastFrom: string
  unread: number
}

export interface PostComment {
  id: string
  authorId: string
  text: string
  at: number
  likes?: string[]
  pinned?: boolean
}

export interface Post {
  id: string
  authorId: string
  text: string
  images: string[]
  topic: string
  featured?: boolean
  likes: string[]
  comments: PostComment[]
  at: number
}

export interface CommunityPostQuery {
  page?: number
  perPage?: number
  topic?: string
  q?: string
  sort?: 'new' | 'hot'
  localFirst?: boolean
  ids?: string[]
}

export interface CommunityPostPage {
  page: number
  perPage: number
  totalItems: number
  totalPages: number
  items: Post[]
}

export interface EventItem {
  id: string
  title: string
  city: string
  cover: string
  date: string
  time: string
  capacity: number
  desc: string
  tags: string[]
  attendees: string[]
  host: string
  creatorId?: string
  requirements?: string
  pinned?: boolean
  venue?: string
  costNote?: string
  cancelNote?: string
  images?: string[]
  region?: string
  comments?: PostComment[]
}

export type EventListScope = 'upcoming' | 'past' | 'mine' | 'hosted' | 'hanfu' | 'calendar'

export interface EventListQuery {
  page?: number
  perPage?: number
  scope?: EventListScope
  ids?: string[]
  from?: string
  to?: string
  localFirst?: boolean
  city?: string
}

export interface EventListPage {
  page: number
  perPage: number
  totalItems: number
  totalPages: number
  items: EventItem[]
}

export interface EventDetailResult {
  event: EventItem
  contacts: Record<string, string>
}

export interface ActivityStats {
  joinedEvents: number
  ownPosts: number
  lastCommentAt: number
}

export type FavType = 'users' | 'posts' | 'events'

export interface Favs {
  users: string[]
  posts: string[]
  events: string[]
}

export interface Visit {
  id: string
  at: number
}

export interface VisitActivity {
  viewerId: string
  viewedId: string
  at: number
}

export interface ChatActivity {
  otherId: string
  at: number
  direction: 'sent' | 'received'
}

export type RelationshipFeedbackOutcome = 'continue' | 'pause'

export interface RelationshipFeedbackState {
  available: boolean
  eligible: boolean
  outcome: RelationshipFeedbackOutcome | null
}

export interface WeeklyActivity {
  visits: VisitActivity[]
  messages: ChatActivity[]
}

export interface ReportRec {
  id: string
  by: string
  target: string
  reason: string
  note: string
  at: number
  status?: 'open' | 'done'
  resolution?: 'ban' | 'dismiss'
  resolvedAt?: number
  appealNote?: string
  appealAt?: number
  appealStatus?: 'open' | 'resolved'
}

export interface WeeklyDigest {
  id: string
  issue: number
  title: string
  intro: string
  postIds: string[]
  at: number
  cover?: string
  covers?: string[]
  views: number
}

export interface Story {
  img: string
  quote: string
  names: string
  city: string
}

export type FeatureKey = 'yuanfen' | 'explore' | 'events' | 'community' | 'matches'

export interface Settings {
  features: Record<FeatureKey, boolean>
  stories: Story[]
  announcement: string
  hiddenEvents: string[]
  festTemplates: Record<string, FestTemplate>
}


export interface MatchState {
  likes: Record<string, string[]>
  passes: Record<string, string[]>
  chats: Record<string, ChatMsg[]>
  reads: Record<string, number>
}

export interface Store {
  users: User[]
  me: User | null
  account: LocalAccount | null
  booted: boolean
  dataReady: boolean
  bootError: string
  retryBoot: () => void
  loadDiscoveryProfiles: (params: { page?: number; perPage?: number; city?: string; district?: string; tags?: string[]; verifiedOnly?: boolean; ageMin?: number; ageMax?: number }) => Promise<{ page: number; perPage: number; totalItems: number; totalPages: number; items: User[] }>
  match: MatchState
  activityStats: ActivityStats
  loadMeHistory: () => Promise<void>
  loadWeeklyActivity: (since: number) => Promise<WeeklyActivity>
  logout: () => void
  saveProfile: (patch: Partial<User>) => Promise<void>
  addPhotos: (urls: string[]) => Promise<void>
  removePhoto: (index: number) => Promise<void>
  setAvatar: (index: number) => Promise<void>
  reorderPhotos: (from: number, to: number) => Promise<void>
  like: (otherId: string) => Promise<boolean>
  unlike: (otherId: string) => Promise<void>
  unpass: (otherId: string) => Promise<void>
  pass: (otherId: string) => Promise<void>
  likesOf: (uid: string) => string[]
  passesOf: (uid: string) => string[]
  mutuals: () => User[]
  conversations: () => Array<{ user: User; lastAt: number; lastText: string; lastFrom: string; liked: boolean }>
  unread: (otherId: string) => number
  markRead: (otherId: string) => Promise<void>
  matchParts: (other: User) => { shared: number; sharedPts: number; agePts: number; cityPts: number; districtPts: number; verifyPts: number }
  isMutual: (otherId: string) => boolean
  chatWith: (otherId: string) => ChatMsg[]
  loadChat: (otherId: string) => Promise<void>
  sendChat: (otherId: string, text: string, images?: string[]) => Promise<void>
  pollChats: (otherId: string) => Promise<void>
  refreshChatSummaries: () => Promise<void>
  loadRelationshipFeedback: (otherId: string) => Promise<RelationshipFeedbackState>
  setRelationshipFeedback: (otherId: string, outcome: RelationshipFeedbackOutcome | null) => Promise<RelationshipFeedbackState>
  posts: Post[]
  loadCommunityPosts: (query: CommunityPostQuery) => Promise<CommunityPostPage>
  events: EventItem[]
  loadEventsPage: (query: EventListQuery) => Promise<EventListPage>
  loadEventDetail: (eventId: string) => Promise<EventItem>
  publish: (text: string, images: string[], topic: string) => Promise<string>
  togglePostLike: (postId: string) => Promise<boolean>
  addComment: (postId: string, text: string) => Promise<void>
  removeComment: (postId: string, commentId: string) => Promise<boolean>
  togglePostFeatured: (postId: string) => Promise<boolean>
  removePost: (postId: string) => Promise<boolean>
  adminEditPostText: (postId: string, text: string) => Promise<boolean>
  editOwnPost: (postId: string, text: string) => Promise<boolean>
  digests: WeeklyDigest[]
  loadCommunityDigests: () => Promise<void>
  publishDigest: (data: { title: string; intro: string; postIds: string[]; cover?: string; covers?: string[] }) => Promise<boolean>
  removeDigest: (id: string) => Promise<boolean>
  viewDigest: (id: string) => Promise<void>
  joinEvent: (eventId: string, contact?: string) => Promise<void>
  leaveEvent: (eventId: string) => Promise<void>
  contacts: Record<string, Record<string, string>>
  createEvent: (data: Omit<EventItem, 'id' | 'attendees' | 'host' | 'creatorId'>) => Promise<string>
  updateEvent: (eventId: string, patch: Partial<EventItem>) => Promise<boolean>
  deleteEvent: (eventId: string) => Promise<boolean>
  togglePinEvent: (eventId: string) => Promise<boolean>
  favs: Favs
  toggleFav: (type: FavType, id: string) => Promise<boolean>
  isFav: (type: FavType, id: string) => boolean
  favGroups: string[]
  favGroupOf: (itemId: string) => string
  addFavGroup: (name: string) => Promise<string | null>
  removeFavGroup: (name: string) => Promise<void>
  renameFavGroup: (oldName: string, newName: string) => Promise<string | null>
  setFavGroup: (itemId: string, group: string) => Promise<void>
  composerDraft: string
  composerDraftTopic: string
  setComposerDraft: (text: string, topic?: string) => void
  recallMsg: (otherId: string, msgId: string) => Promise<void>
  addEventComment: (eventId: string, text: string) => Promise<void>
  toggleEventCommentLike: (eventId: string, commentId: string) => Promise<boolean>
  toggleEventCommentPin: (eventId: string, commentId: string) => Promise<boolean>
  deleteEventComment: (eventId: string, commentId: string) => Promise<boolean>
  recordVisit: (viewedId: string) => Promise<void>
  visitorsOf: (uid: string) => Array<{ user: User; at: number }>
  visits: Record<string, Visit[]>
  blocks: string[]
  isBlocked: (uid: string) => boolean
  toggleBlock: (uid: string) => Promise<boolean>
  reportUser: (uid: string, reason: string, note: string) => Promise<string>
  resolveReport: (reportId: string, action: 'ban' | 'dismiss') => Promise<boolean>
  appealReport: (reportId: string, note: string) => Promise<void>
  unbanUser: (uid: string) => Promise<boolean>
  banUser: (uid: string) => Promise<boolean>
  resetMemberPassword: (uid: string) => Promise<string | null>
  adminSetUserPhoto: (uid: string, dataUrl: string) => Promise<boolean>
  adminSetEventCover: (eventId: string, dataUrl: string) => Promise<boolean>
  adminSetPostImages: (postId: string, images: string[]) => Promise<boolean>
  adminLogs: Array<{ id: string; at: number; text: string }>
  reports: ReportRec[]
  checkins: Record<string, string[]>
  checkinEvent: (eventId: string, code: string) => Promise<void>
  getEventCheckinCode: (eventId: string) => Promise<string>
  tour: Record<string, boolean>
  markTour: (key: string) => Promise<void>
  reminders: string[]
  toggleReminder: (eventId: string) => Promise<boolean>
  upcomingReminded: () => Array<{ event: EventItem; days: number }>
  icebreakerFor: (other: User) => string
  candidates: () => User[]
  dailyYuanfen: () => User[]
  matchScore: (other: User) => number
  settings: Settings
  saveSettings: (patch: Partial<Settings>) => Promise<boolean>
  featureOn: (k: FeatureKey) => boolean
  toggleEventHidden: (eventId: string) => Promise<boolean>
}
