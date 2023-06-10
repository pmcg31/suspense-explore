import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import readline from 'readline';

const prisma = new PrismaClient();

async function main() {
  const stream = fs.createReadStream('prisma/classic-rock-song-list.csv');

  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  let first = true;
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
            // This is the end of a quoted string, so
            // this field is complete; push it onto the
            // fields array and reset field for the next
            fields.push(field);
            field = '';

            // Check if we're done with this line (done
            // when 3 fields have been collected)
            if (fields.length === 3) {
              break;
            }

            // Set target to dash to indicate that we should
            // ignore the next comma that will be after this
            // closing quote
            targetCh = '-';
          }
        } else if (c === ',') {
          if (targetCh === '"') {
            // Ignore this comma (it is inside of
            // quotes), but add it to the field
            // we're building up
            // field = field.concat(c);
            field += c;
          } else if (targetCh === ',') {
            // This comma is the end of a field
            fields.push(field);
            field = '';

            // Check if we're done with this line (done
            // when 3 fields have been collected)
            if (fields.length === 3) {
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

      // Line parsing complete; do we know about
      // this artist already?
      let artist = await prisma.artist.findFirst({
        where: {
          name: fields[1]
        }
      });
      if (artist === null) {
        // No, create it
        artist = await prisma.artist.create({
          data: {
            name: fields[1]
          }
        });
      }

      // Store the song
      await prisma.song.create({
        data: {
          name: fields[0],
          artistId: artist.id,
          year: Number(fields[2]) || 0
        }
      });

      // Reset fields
      fields = [];
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
