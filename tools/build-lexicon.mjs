// Builds skills/dubwise/assets/lexicon.bin, the word map dubwise reads unknown words with, from
// potion-multilingual-128M (MIT, https://huggingface.co/minishlab/potion-multilingual-128M), a static embedding
// model: every token has a vector, and a phrase is the mean of its tokens' vectors.
// The full model is 512 MB. This keeps the tokens written in the letters of Portuguese, Spanish and English, projects
// their vectors on the 64 main axes of the kept set (PCA) and stores each value in 4 bits, about 9 MB in all.
// Usage: node tools/build-lexicon.mjs [download folder]   (the model is downloaded once into that folder)
import { existsSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MODEL = "https://huggingface.co/minishlab/potion-multilingual-128M/resolve/main";
const OUT = join(import.meta.dirname, "..", "skills", "dubwise", "assets", "lexicon.bin");
const DIMS = 64;
const BITS = 4;
/** Tokens kept: lower-case words and word pieces in the letters of Portuguese, Spanish and English. */
const KEEP = /^▁?[a-z0-9áàâãéêíóôõúüçñ]+$|^▁$/;

const folder = process.argv[2] ?? join(homedir(), ".cache", "dubwise-potion");
mkdirSync(folder, { recursive: true });
for (const file of ["tokenizer.json", "model.safetensors"]) {
    if (existsSync(join(folder, file))) continue;
    console.log(`downloading ${file}`);
    const response = await fetch(`${MODEL}/${file}`);
    if (!response.ok) throw new Error(`${file}: ${response.status}`);
    writeFileSync(join(folder, file), Buffer.from(await response.arrayBuffer()));
}

/** @type {{ model: { vocab: [string, number][] } }} */
const tokenizer = JSON.parse(readFileSync(join(folder, "tokenizer.json"), "utf8"));
const kept = tokenizer.model.vocab.flatMap(([piece, score], id) => (KEEP.test(piece) ? [{ piece, score, id }] : []));

// The vectors of the kept tokens, read row by row from the safetensors file.
const file = openSync(join(folder, "model.safetensors"), "r");
const size = Buffer.alloc(8);
readSync(file, size, 0, 8, 0);
const header = Buffer.alloc(Number(size.readBigUInt64LE(0)));
readSync(file, header, 0, header.length, 8);
const { shape } = JSON.parse(header.toString()).embeddings;
const width = shape[1];
const full = new Float32Array(kept.length * width);
const row = Buffer.alloc(width * 4);
for (const [i, { id }] of kept.entries()) {
    readSync(file, row, 0, row.length, 8 + header.length + id * width * 4);
    full.set(new Float32Array(row.buffer, row.byteOffset, width), i * width);
}

// Principal axes of the kept vectors, from their covariance on a sample, by Jacobi rotations.
const mean = new Float64Array(width);
for (let i = 0; i < kept.length; i++) for (let d = 0; d < width; d++) mean[d] += full[i * width + d] / kept.length;
const covariance = Array.from({ length: width }, () => new Float64Array(width));
const stride = Math.max(1, Math.floor(kept.length / 40000));
let samples = 0;
const centered = new Float64Array(width);
for (let i = 0; i < kept.length; i += stride, samples++) {
    for (let d = 0; d < width; d++) centered[d] = full[i * width + d] - mean[d];
    for (let a = 0; a < width; a++) for (let b = a; b < width; b++) covariance[a][b] += centered[a] * centered[b];
}
for (let a = 0; a < width; a++) for (let b = a; b < width; b++) covariance[b][a] = covariance[a][b] /= samples;
const axes = principalAxes(covariance).slice(0, DIMS);

// Project, then store each axis in 4 bits around its own scale.
const projected = new Float32Array(kept.length * DIMS);
const scales = new Float32Array(DIMS);
for (let i = 0; i < kept.length; i++) {
    for (let c = 0; c < DIMS; c++) {
        let value = 0;
        for (let d = 0; d < width; d++) value += (full[i * width + d] - mean[d]) * axes[c][d];
        projected[i * DIMS + c] = value;
        scales[c] = Math.max(scales[c], Math.abs(value));
    }
}
const levels = 2 ** (BITS - 1) - 1;
for (let c = 0; c < DIMS; c++) scales[c] /= levels;
const packed = new Uint8Array((kept.length * DIMS) / 2);
for (let i = 0; i < projected.length; i++) {
    const level = Math.max(-levels, Math.min(levels, Math.round(projected[i] / scales[i % DIMS])));
    packed[i >> 1] |= (level & 0x0f) << ((i & 1) * 4);
}

// File: a JSON header and its length, then piece scores (int16, thousandths), the pieces, the packed vectors.
const scores = new Int16Array(kept.map(({ score }) => Math.round(score * 1000)));
const pieces = Buffer.from(kept.map(({ piece }) => piece).join("\n"));
const meta = Buffer.from(
    JSON.stringify({
        format: "dubwise-lexicon 1",
        source: "minishlab/potion-multilingual-128M (MIT)",
        count: kept.length,
        dims: DIMS,
        bits: BITS,
        scales: [...scales],
        piecesBytes: pieces.length,
    }),
);
const head = Buffer.alloc(4);
head.writeUInt32LE(meta.length);
const pad = Buffer.alloc((8 - ((4 + meta.length) % 8)) % 8, 0x20);
writeFileSync(OUT, Buffer.concat([head, meta, pad, Buffer.from(scores.buffer), pieces, Buffer.from(packed.buffer)]));
console.log(
    `${kept.length} tokens, ${DIMS} axes at ${BITS} bits: ${OUT} (${(readFileSync(OUT).length / 1e6).toFixed(1)} MB)`,
);

/**
 * Eigenvectors of a symmetric matrix, largest eigenvalue first, by cyclic Jacobi rotations.
 * @param {Float64Array[]} matrix @returns {Float64Array[]}
 */
function principalAxes(matrix) {
    const n = matrix.length;
    const a = matrix.map((r) => Float64Array.from(r));
    const v = Array.from({ length: n }, (_, i) => Float64Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
    for (let sweep = 0; sweep < 12; sweep++) {
        let off = 0;
        for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] ** 2;
        if (off < 1e-14) break;
        for (let p = 0; p < n; p++) {
            for (let q = p + 1; q < n; q++) {
                if (Math.abs(a[p][q]) < 1e-14) continue;
                const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
                const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
                const c = 1 / Math.sqrt(t * t + 1);
                const s = t * c;
                for (let k = 0; k < n; k++) {
                    [a[k][p], a[k][q]] = [c * a[k][p] - s * a[k][q], s * a[k][p] + c * a[k][q]];
                }
                for (let k = 0; k < n; k++) {
                    [a[p][k], a[q][k]] = [c * a[p][k] - s * a[q][k], s * a[p][k] + c * a[q][k]];
                }
                for (let k = 0; k < n; k++) {
                    [v[k][p], v[k][q]] = [c * v[k][p] - s * v[k][q], s * v[k][p] + c * v[k][q]];
                }
            }
        }
    }
    const order = Array.from({ length: n }, (_, i) => i).sort((x, y) => a[y][y] - a[x][x]);
    return order.map((i) => Float64Array.from({ length: n }, (_, k) => v[k][i]));
}
