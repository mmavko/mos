const fs = require("fs");
const { Readable, finished } = require("stream");
const pics = require("pics");
const ColorTransform = require("color-transform");
const concat = require("concat-frames");
const resize = require("resizer-stream");

pics.use(require("gif-stream"));
pics.use(require("jpg-stream"));
pics.use(require("png-stream"));

const COLOR_SPACE = "rgb";
const COLOR_COMPONENTS = 3;

const TILE_SIZE = 20;
const TILE_STEPS = 2;
const LARGER_SIZE_TILES_NUM = 60;

const file1 = "./images/3056964568_0962e9649a_o.jpg";
const file2 = "./images/Abraham_Lincoln_O-116_by_Gardner,_1865-crop.png";
const file3 = "./images/Insane_old_man.jpg";
const file4 = "./images/old man.jpg";
const file5 = "./images/people-q-g-1000-800-2.jpg";
const file6 = "./images/026_yurko__ds__52.jpg";

////////////////////////////////////////////////////////////////////

class Array2D extends Array {
  map2D(mapper) {
    return this.map((arr, row) => arr.map((el, col) => mapper(el, col, row)));
  }
}

const range = (start, stop, step = 1) =>
  new Array2D(Math.ceil((stop - start) / step))
    .fill(start)
    .map((x, y) => x + y * step);

const rangeEvenInc = (start, stop, stepCount) =>
  stop === start
    ? new Array2D(1).fill(start)
    : range(start, stop, (stop - start) / stepCount).concat(stop);

////////////////////////////////////////////////////////////////////

const fileToStream = fileName =>
  fs
    .createReadStream(fileName)
    .pipe(pics.decode())
    .pipe(new ColorTransform(COLOR_SPACE));

const streamToFile = (stream, fileName) =>
  new Promise(resolve =>
    finished(
      stream
        .pipe(pics.encode("image/jpeg"))
        .pipe(fs.createWriteStream(fileName)),
      resolve
    )
  );

// image = {
//   width: 1024,
//   height: 803,
//   colorSpace: "rgb",
//   pixels:
//     <Buffer 6f 81 8d 6f 81 8d 6f 81 8d 81 ... 2466766 more bytes>,
// };

const streamToImage = stream =>
  new Promise(resolve => stream.pipe(concat(frames => resolve(frames[0]))));

const imageToStream = ({ width, height, pixels }) => {
  const readable = new Readable();
  readable._read = function() {
    this.emit("format", { width, height, colorSpace: COLOR_SPACE });
    this.push(pixels);
    this.push(null);
  };
  return readable;
};

const adjustSize = image => {
  const { width, height, pixels } = image;
  const largerSide = Math.max(width, height);
  const smallerSide = Math.min(width, height);
  const newLargerSide = TILE_SIZE * LARGER_SIZE_TILES_NUM;
  const newSmallerSide = Math.round((smallerSide * newLargerSide) / largerSide);

  const newWidth = width >= height ? newLargerSide : newSmallerSide;
  const newHeight = height > width ? newLargerSide : newSmallerSide;

  return streamToImage(
    imageToStream(image).pipe(
      resize({
        width: newWidth,
        height: newHeight,
        fit: false,
        allowUpscale: true
      })
    )
  );
};

const cropImage = ({ width, height, pixels }, x1, y1, x2, y2) =>
  Buffer.concat(
    range(y1, y2).map(y =>
      pixels.subarray(
        (y * width + x1) * COLOR_COMPONENTS,
        (y * width + x2) * COLOR_COMPONENTS
      )
    )
  );

const cropImageTile = (image, col, row) =>
  cropImage(image, col, row, col + TILE_SIZE, row + TILE_SIZE);

const initTileSpace = ({ width, height, pixels }) =>
  range(0, Math.floor(height / TILE_SIZE)).map(row =>
    range(0, Math.floor(width / TILE_SIZE)).map(col => undefined)
  );

const tileRowLength = TILE_SIZE * COLOR_COMPONENTS;

const tileSpaceToImage = tiles => ({
  width: tiles[0].length * TILE_SIZE,
  height: tiles.length * TILE_SIZE,
  colorSpace: COLOR_SPACE,
  pixels: Buffer.concat(
    tiles.map(arr =>
      Buffer.concat(
        range(0, TILE_SIZE).map(y =>
          Buffer.concat(
            arr.map(pixels =>
              pixels.subarray(y * tileRowLength, (y + 1) * tileRowLength)
            )
          )
        )
      )
    )
  )
});

const generateTiles = async sourceImg => {
  const { width, height } = sourceImg;
  const smallerSide = Math.min(width, height);
  const minScale = TILE_SIZE / smallerSide;
  const maxScale = (TILE_SIZE * 2) / smallerSide;
  const scales = rangeEvenInc(minScale, maxScale, 2);
  return (
    await Promise.all(
      scales.map(async scale => {
        const image = await streamToImage(
          imageToStream(sourceImg).pipe(resize({ scale, allowUpscale: true }))
        );
        const { width, height } = image;
        const cropSteps = side =>
          rangeEvenInc(
            0,
            side - TILE_SIZE,
            Math.ceil((side - TILE_SIZE) / (TILE_SIZE / TILE_STEPS))
          );
        return cropSteps(width).map(x =>
          cropSteps(height).map(y =>
            cropImageTile(image, Math.round(x), Math.round(y))
          )
        );
      })
    )
  ).flat(2);
};

const diffTiles = (pixels1, pixels2) => {
  let diff = 0;
  for (const [index] of pixels1.entries()) {
    diff += Math.abs(pixels1.readUInt8(index) - pixels2.readUInt8(index));
  }
  return diff;
};

const mosaify = async (image, sources) => {
  const tiles = initTileSpace(image).map2D((_, col, row) => ({
    diff: Number.MAX_VALUE,
    original: cropImageTile(image, col * TILE_SIZE, row * TILE_SIZE),
    substitute: null
  }));
  await Promise.all(
    sources.map(async fileName => {
      const source = await streamToImage(fileToStream(fileName));
      const sourceTiles = await generateTiles(source);
      console.log(`    - looking for substitutes from ${fileName}`);
      tiles.map2D(obj => {
        const { original } = obj;
        sourceTiles.forEach(sourceTile => {
          const tileDiff = diffTiles(sourceTile, original);
          if (tileDiff < obj.diff) {
            obj.diff = tileDiff;
            obj.substitute = sourceTile;
          }
        });
      });
    })
  );
  return tileSpaceToImage(tiles.map2D(({ substitute }) => substitute));
};

main();

async function main() {
  console.log("1) reading and decoding image...");
  const original = await streamToImage(fileToStream(file1));
  console.log("2) resizing...");
  const big = await adjustSize(original);
  console.log("3) mosaifying...");
  const mosaic = await mosaify(big, [file1, file2, file3]);
  console.log("4) encoding image and writing to a file...");
  await streamToFile(imageToStream(mosaic), "out.jpg");
  console.log("done");
}
