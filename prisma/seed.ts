import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import readline from 'readline';
import fetch from 'node-fetch';

const prisma = new PrismaClient();

type ArtistInfo = {
  mbArtistId: string;
  artistName: string;
};

type TrackInfo = {
  mbTrackId: string;
  volume: number;
  side: string;
  trackNum: number;
  name: string;
};

type AlbumVersionInfo = {
  mbReleaseId: string;
  format: string;
  year: number;
  country: string;
  hasSides: boolean;
  isMultiVolume: boolean;
  tracks: TrackInfo[];
};

type AlbumInfo = {
  mbReleaseGroupId: string;
  name: string;
  versions: AlbumVersionInfo[];
};

const preferredCountries = ['US', 'CA', 'GB'];
const artistCache = new Map<string, ArtistInfo | null>();

function matchTrackName(songName: string, trackName: string): boolean {
  if (songName === trackName) {
    return true;
  }
  if (trackName.startsWith(songName)) {
    return true;
  }
  if (songName.startsWith(trackName)) {
    return true;
  }

  return false;
}

async function wait(timeout_ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, timeout_ms);
  });
}

async function fetchWithBackoff(url: string): Promise<any> {
  try {
    // Fetch data from the url
    while (true) {
      const response = await fetch(url);
      if (response.ok) {
        return response.json();
      } else {
        if (response.status !== 503) {
          console.error(
            `fetch returned status ${response.status} ${await response.text()}`
          );
        } else {
          await wait(100);
        }
      }
    }
  } catch (error) {
    console.error(error);
  }
}

async function mbFindArtist(artistName: string): Promise<ArtistInfo | null> {
  // Check cache
  let artistInfo = artistCache.get(artistName);
  if (artistInfo === undefined) {
    const url = encodeURI(
      `https://musicbrainz.org/ws/2/artist/?fmt=json&query=artist:${artistName.toLowerCase()}`
    );
    // console.log(url);

    // Fetch data from the url
    const data = await fetchWithBackoff(url);

    if (data && data.artists && data.artists.length != 0) {
      artistInfo = {
        mbArtistId: data.artists[0].id,
        artistName: data.artists[0].name
      };
    }

    artistCache.set(artistName, artistInfo || null);
  }

  return artistInfo || null;
}

async function mbFindReleaseRecording(
  mbReleaseId: string
): Promise<AlbumVersionInfo | null> {
  const url = encodeURI(
    `https://musicbrainz.org/ws/2/recording/?fmt=json&query=reid:${mbReleaseId}`
  );
  // console.log(url);

  // Fetch data from the url
  const response = await fetch(url);
  const data = await response.json();

  if (data && data.recordings) {
    let albumVersionInfo: AlbumVersionInfo | null = null;
    for (const recording of data.recordings) {
      for (const release of recording.releases) {
        if (release.media && release.country && release.date) {
          if (preferredCountries.includes(release.country)) {
            const media = release.media[0];
            if (release.id === mbReleaseId) {
              const track = media.track[0];
              if (albumVersionInfo === null) {
                albumVersionInfo = {
                  mbReleaseId: release.id,
                  format: media.format,
                  year: Number(release.date.substring(0, 4)) || 0,
                  country: release.country,
                  hasSides: false,
                  isMultiVolume: false,
                  tracks: []
                };
              }
              let trackNum = 0;
              let side = '';
              const volume = media.position;
              if (!isNaN(track.number.charAt(0).toLowerCase())) {
                trackNum = Number(track.number);
              } else {
                side = track.number.charAt(0);
                trackNum = Number(track.number.substring(1, 2));
                albumVersionInfo.hasSides = true;
              }
              if (volume > 1) {
                albumVersionInfo.isMultiVolume = true;
              }
              albumVersionInfo.tracks.push({
                mbTrackId: track.id,
                volume,
                side,
                trackNum,
                name: track.title
              });
            }
          }
        }
      }
    }

    // Sort tracks by track number if
    // there is data
    if (albumVersionInfo) {
      albumVersionInfo.tracks.sort((a, b) => {
        if (a.volume < b.volume) {
          return -1;
        } else if (a.volume > b.volume) {
          return 1;
        } else {
          if (a.side < b.side) {
            return -1;
          } else if (a.side > b.side) {
            return 1;
          } else {
            if (a.trackNum < b.trackNum) {
              return -1;
            } else if (a.trackNum > b.trackNum) {
              return 1;
            } else {
              return 0;
            }
          }
        }
      });
    }

    return albumVersionInfo;
  }

  return null;
}

async function mbFindArtistReleaseGroup(
  mbArtistId: string,
  albumName: string
): Promise<AlbumInfo | null> {
  const url = encodeURI(
    `https://musicbrainz.org/ws/2/release-group/?fmt=json&query=releasegroup:${albumName} AND arid:${mbArtistId} AND primarytype:Album`
  );
  // console.log(url);

  // Fetch data from the url
  const data = await fetchWithBackoff(url);

  // Return the first release group
  if (data && data['release-groups']) {
    const releaseGroup = data['release-groups'][0];

    const albumVersions: AlbumVersionInfo[] = [];
    for (const release of releaseGroup.releases) {
      const albumVersionInfo = await mbFindReleaseRecording(release.id);
      if (albumVersionInfo) {
        albumVersions.push(albumVersionInfo);
      }
    }

    return {
      mbReleaseGroupId: releaseGroup.id,
      name: releaseGroup.title,
      versions: albumVersions
    };
  } else {
    return null;
  }
}

// async function mbFindAlbumName({
//   songName,
//   artistName
// }: {
//   songName: string;
//   artistName: string;
// }): Promise<AlbumInfo | null> {
//   // Get artist info
//   const artistInfo = await mbFindArtist(artistName);
//   console.log(artistInfo);

//   if (artistInfo) {
//     const releaseGroups = await mbFindArtistReleaseGroups(
//       artistInfo.mbArtistId,
//       ''
//     );
//     for (const rg of releaseGroups) {
//       console.log(`${rg.name} (${rg.mbReleaseIds.length})`);
//       for (const releaseId of rg.mbReleaseIds) {
//         // console.log(`  ${releaseId}`);
//         await mbFindReleaseRecording(releaseId, songName);
//       }
//     }
//   }

//   return null;

//   //
//   // Try to find an album for this song
//   //

//   // Construct url
//   const url = encodeURI(
//     `https://musicbrainz.org/ws/2/recording/?fmt=json&query=recording:${songName.toLowerCase()} AND artistname:${artistName.toLowerCase()} AND -secondarytype:* AND status:official AND -comment:live`
//   );
//   console.log(url);

//   // Fetch data from the url
//   const response = await fetch(url);
//   const data = await response.json();
//   const candidates: AlbumInfo[] = [];
//   if (data) {
//     for (const recording of data.recordings) {
//       for (const release of recording.releases) {
//         const country = String(release.country);
//         const yearStr = String(release.date).substring(0, 4);
//         const year = Number(yearStr);
//         if (release['release-group']['primary-type'] === 'Album') {
//           for (const medium of release.media) {
//             const format = String(medium.format).toLowerCase();
//             console.log(
//               `year: ${year} cc: ${country} format: ${format} name: ${release.title}`
//             );
//             candidates.push({
//               mbReleaseId: release.id,
//               albumName: release.title,
//               releaseCountry: country,
//               releaseYear: year
//             });
//           }
//         }
//       }
//     }
//   }

//   if (candidates.length === 0) {
//     return null;
//   } else if (candidates.length === 1) {
//     return candidates[0];
//   } else {
//     let oldest = 10000;
//     let oldestUS = 10000;
//     let oldestIdx = -1;
//     let oldestUSIdx = -1;
//     const usIdxs: number[] = [];
//     let idx = 0;
//     for (const candidate of candidates) {
//       console.log(`cand: ${candidate.releaseYear} oldest: ${oldest}`);
//       if (candidate.releaseYear < oldest) {
//         oldest = candidate.releaseYear;
//         oldestIdx = idx;
//       }
//       if (
//         candidate.releaseCountry === 'US' &&
//         candidate.releaseYear < oldestUS
//       ) {
//         oldestUS = candidate.releaseYear;
//         oldestUSIdx = idx;
//       }

//       idx++;
//     }

//     // Go with the oldest US release, and if
//     // no US release, just the oldest
//     if (oldestUSIdx != -1) {
//       return candidates[oldestUSIdx];
//     } else {
//       return candidates[oldestIdx];
//     }
//   }
// }

async function getMBInfo({
  albumName,
  artistName
}: {
  albumName: string;
  artistName: string;
}) {
  const artistInfo = await mbFindArtist(artistName);
  if (artistInfo) {
    console.log(`  ${artistInfo.artistName} -- id: ${artistInfo.mbArtistId}`);

    const albumInfo = await mbFindArtistReleaseGroup(
      artistInfo.mbArtistId,
      albumName
    );

    if (albumInfo) {
      console.log(
        `  ${albumInfo.name} -- release group id: ${albumInfo.mbReleaseGroupId} (${albumInfo.versions.length})`
      );

      for (const version of albumInfo.versions) {
        console.log(
          `    ${version.country} ${version.year} [${version.format}] release id: ${version.mbReleaseId}`
        );

        for (const track of version.tracks) {
          if (version.isMultiVolume) {
            console.log(
              `      ${track.volume}-${track.side}${track.trackNum}. ${track.name} track id: ${track.mbTrackId}`
            );
          } else {
            console.log(
              `      ${track.side}${track.trackNum}. ${track.name} track id: ${track.mbTrackId}`
            );
          }
        }
      }
    }
  }
}

async function storeSongs({
  albumName,
  artistName
}: {
  albumName: string;
  artistName: string;
}) {
  console.log(`${artistName} | ${albumName}`);
  await getMBInfo({ albumName, artistName });

  // // Do we know about this artist already?
  // let artist = await prisma.artist.findFirst({
  //   where: {
  //     name: artistName
  //   }
  // });
  // if (artist === null) {
  //   // No, create it
  //   artist = await prisma.artist.create({
  //     data: {
  //       name: artistName
  //     }
  //   });
  // }

  // // Store the song
  // await prisma.song.create({
  //   data: {
  //     name: songName,
  //     artistId: artist.id,
  //     year
  //   }
  // });
}

async function main() {
  const stream = fs.createReadStream('prisma/albumlist.csv');

  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  let first = true;
  let count = 0;
  for await (const line of rl) {
    if (first) {
      // Skip the header line
      first = false;
    } else {
      let fields: string[] = [];
      let targetCh = ',';
      let field = '';
      for (const c of line) {
        if (c === '"') {
          if (targetCh === ',') {
            // We were searching for a comma, but found a
            // quote, so this is the beginning of a
            // quoted string; switch to targeting the
            // closing quote
            targetCh = '"';
          } else if (targetCh === '"') {
            // This is either the start of an escaped quote
            // (i.e., two quotes in a row) or the end of a
            // field. Set target to dash to indicate that we
            // should either a) end the field if the next
            // character is a comma, or b) append a quote to
            // the field if the next character is a quote
            targetCh = '-';
          } else if (targetCh === '-') {
            // Last character was a quote (because targetCh
            // is a dash), so append a quote to field and
            // target quotes
            field += '"';
            targetCh = '"';
          }
        } else if (c === ',') {
          if (targetCh === '"') {
            // Ignore this comma (it is inside of
            // quotes), but add it to the field
            // we're building up
            // field = field.concat(c);
            field += c;
          } else if (targetCh === ',' || targetCh === '-') {
            // This comma is the end of a field
            fields.push(field);
            field = '';

            // Check if we're done with this line (done
            // when 4 fields have been collected)
            if (fields.length === 4) {
              break;
            }
          } else if (targetCh === '-') {
            // Ignore this comma (it is after a close
            // quote); set target to comma
            targetCh = ',';
          }
        } else {
          // Just add to the field we're building up
          //   field = field.concat(c);
          field += c;
        }
      }

      // Line parsing complete; store song in db
      await storeSongs({
        albumName: fields[2],
        artistName: fields[3]
      });

      // Reset fields
      fields = [];

      count++;
      if (count > 20) {
        console.log('done');
        break;
      }
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
