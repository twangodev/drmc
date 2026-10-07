import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultMusicPreferences, readMusicPreferences } from '../src/lib/music-preferences.ts'
import { lastfmArtwork, lastfmMusicLink, lastfmTrackUrl, type ListeningTrack } from '../src/lib/music.ts'
import { musicActivity } from '../src/lib/server/discord/music-activity.ts'
import { providerRetryAfter } from '../src/lib/server/lastfm/client.ts'

const track: ListeningTrack = { title: 'Everything In Its Right Place', artist: 'Radiohead', album: 'Kid A', artwork: 'https://lastfm.freetls.fastly.net/i/u/300x300/cover.png', loved: true, startedAt: 1_700_000_000_000 }
const images = { logo: '970027358432161832', heart: '970173669169053717' }

test('CLI defaults and native form preferences preserve every presence control', () => {
  assert.deepEqual(defaultMusicPreferences, { refreshInterval: 10, statusDisplay: 'song', showProfile: true, showLoved: false, showCovers: true, showElapsed: true, keepStatus: false, debug: false })
  const preferences = readMusicPreferences(new URLSearchParams({ refreshInterval: '30', showLoved: 'on', keepStatus: 'on', debug: 'on' }))
  assert.deepEqual(preferences, { refreshInterval: 30, statusDisplay: 'song', showProfile: false, showLoved: true, showCovers: false, showElapsed: false, keepStatus: true, debug: true })
  assert.equal(readMusicPreferences(new URLSearchParams({ refreshInterval: '10', statusDisplay: 'artist' })).statusDisplay, 'artist')
  for (const statusDisplay of ['', 'album', 'ARTIST']) assert.throws(() => readMusicPreferences(new URLSearchParams({ refreshInterval: '10', statusDisplay })), /invalid_music_preferences/)
  for (const interval of ['', '0', '-1', '1.5', 'NaN', '3601', '99999']) assert.throws(() => readMusicPreferences(new URLSearchParams({ refreshInterval: interval })), /invalid_music_preferences/)
  assert.throws(() => readMusicPreferences(new URLSearchParams({ refreshInterval: '10', showLoved: 'false' })), /invalid_music_preferences/)
  for (const interval of ['1', '3600']) assert.equal(readMusicPreferences(new URLSearchParams({ refreshInterval: interval })).refreshInterval, Number(interval))
})

test('the Listening activity has the CLI profile and track buttons, album cover, badge, and elapsed time', () => {
  assert.deepEqual(musicActivity(track, 'twangodev', { ...defaultMusicPreferences }, images), {
    name: track.title, type: 2, details: track.title, state: 'by Radiohead', timestamps: { start: track.startedAt },
    assets: { large_image: track.artwork, large_text: 'Kid A', small_image: images.logo, small_text: 'drmc • 1.0.0' },
    buttons: [{ label: 'Visit last.fm Profile', url: 'https://www.last.fm/user/twangodev' }, { label: 'View scrobble on Last.fm', url: 'https://www.last.fm/music/Radiohead/_/Everything%20In%20Its%20Right%20Place' }],
  })
  const customized = musicActivity(track, 'twangodev', { ...defaultMusicPreferences, showProfile: false, showLoved: true, showCovers: false, showElapsed: false }, images)!
  assert.deepEqual(customized.buttons, [{ label: 'View scrobble on Last.fm', url: lastfmTrackUrl(track) }])
  assert.deepEqual(customized.assets, { small_image: images.heart, small_text: 'drmc • 1.0.0' })
  assert.equal(customized.timestamps, undefined)
  assert.equal(musicActivity({ ...track, loved: false }, 'twangodev', { ...defaultMusicPreferences, showLoved: true }, images)!.assets!.small_image, images.logo)
  const artistStatus = musicActivity(track, 'twangodev', { ...defaultMusicPreferences, statusDisplay: 'artist' }, images)!
  assert.equal(artistStatus.name, track.artist)
  assert.equal(artistStatus.details, track.title)
})

test('album art is independent of registered badges and missing covers fall back to the logo', () => {
  const withoutBadges = musicActivity(track, 'twangodev', { ...defaultMusicPreferences }, {})!
  assert.deepEqual(withoutBadges.assets, { large_image: track.artwork, large_text: track.album })
  const withoutCover = musicActivity({ ...track, artwork: undefined }, 'twangodev', { ...defaultMusicPreferences }, images)!
  assert.equal(withoutCover.assets!.large_image, images.logo)
  const withoutAlbum = musicActivity({ ...track, album: '' }, 'twangodev', { ...defaultMusicPreferences }, images)!
  assert.equal(withoutAlbum.assets!.large_text, track.title)
})

test('idle status is opt-in and never carries the last track or an elapsed timer', () => {
  assert.equal(musicActivity(null, 'twangodev', { ...defaultMusicPreferences }, images), null)
  assert.deepEqual(musicActivity(null, 'twangodev', { ...defaultMusicPreferences, keepStatus: true }, images), {
    name: 'Last.fm', type: 0, details: 'drmc', state: '1.0.0', assets: { large_image: images.logo },
  })
})

test('missing application assets and long links degrade without sending invalid image keys or buttons', () => {
  const activity = musicActivity({ ...track, artwork: undefined, url: 'https://www.last.fm/music/' + 'a'.repeat(512) }, 'twangodev', { ...defaultMusicPreferences }, {})!
  assert.deepEqual(activity.assets, {})
  assert.deepEqual(activity.buttons, [{ label: 'Visit last.fm Profile', url: 'https://www.last.fm/user/twangodev' }])
})

test('API links and artwork reject foreign origins and placeholders while preserving encoded track names', () => {
  assert.equal(lastfmTrackUrl({ title: 'A/B & C', artist: 'AC/DC' }), 'https://www.last.fm/music/AC%2FDC/_/A%2FB%20%26%20C')
  assert.equal(lastfmMusicLink('http://www.last.fm/music/Radiohead/_/Kid+A'), 'https://www.last.fm/music/Radiohead/_/Kid+A')
  for (const url of ['javascript:alert(1)', 'https://evil.example/music/song', 'https://www.last.fm@evil.example/music/song', 'https://www.last.fm/api/auth/']) assert.equal(lastfmMusicLink(url), undefined)
  assert.equal(lastfmArtwork('https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png'), undefined)
  assert.equal(lastfmArtwork('https://lastfm-img.freetls.fastly.net/i/u/300x300/cover.png'), 'https://lastfm-img.freetls.fastly.net/i/u/300x300/cover.png')
  assert.equal(lastfmArtwork('http://lastfm-img.freetls.fastly.net/i/u/300x300/cover.png'), 'https://lastfm-img.freetls.fastly.net/i/u/300x300/cover.png')
  assert.equal(lastfmArtwork('https://lastfm-img.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png'), undefined)
  assert.equal(lastfmArtwork('https://lastfm-img.freetls.fastly.net.evil.example/cover.png'), undefined)
  assert.equal(lastfmArtwork('https://lastfm-img.freetls.fastly.net@evil.example/cover.png'), undefined)
  assert.equal(lastfmArtwork('https://evil.example/cover.png'), undefined)
})

test('Last.fm Retry-After supports seconds and dates without accepting invalid or unbounded delays', () => {
  const now = Date.parse('2026-10-06T00:00:00Z')
  assert.equal(providerRetryAfter('120', now), 120_000)
  assert.equal(providerRetryAfter('Tue, 06 Oct 2026 00:02:00 GMT', now), 120_000)
  for (const value of [null, '', '0', '-1', 'invalid', 'Mon, 05 Oct 2026 00:00:00 GMT']) assert.equal(providerRetryAfter(value, now), undefined)
  assert.equal(providerRetryAfter('999999999', now), 24 * 3600_000)
})
