/*!
Front-end build tools
Copyright 2022, Anthony DePasquale (anthony@depasquale.org)
*/

import path from 'path';
import fs from 'fs-extra';
import { exec } from 'child_process';

import nunjucks from 'nunjucks';
import pretty from 'pretty';

import * as sass from 'sass'; // Dart Sass is the standard for the future, but slower
// import sass from 'node-sass'; // node-sass is depricated but still maintained and faster
import autoprefixer from 'autoprefixer';
import postcss from 'postcss';
import { PurgeCSS } from 'purgecss';

import { transformFileAsync } from '@babel/core';
import UglifyJS from 'uglify-js';

export const compileNunjucks = ({ inputPath, outputPath, templates, globalVars = {}, data = {} }) => new Promise((resolve, reject) => {
  if (!inputPath) throw new Error('No inputPath provided to compileNunjucks');
  if (!outputPath) throw new Error('No outputPath provided to compileNunjucks');
  if (!templates) throw new Error('No templates provided to compileNunjucks');
  console.log(`Compiling Nunjucks templates from ${inputPath}`);
  Object.keys(globalVars).forEach((globalVar) => {
    const globalVarVal = globalVars[globalVar];
    nunjucks.configure(templates /* , { options } */).addGlobal(globalVar, globalVarVal);
  });
  nunjucks.render(inputPath, data, (err, res) => {
    if (err) {
      reject(err);
    } else {
      console.log(`Beautifying ${outputPath} from Nunjucks`);
      const beautifiedHtml = pretty(res, { ocd: true });
      fs.writeFile(outputPath, beautifiedHtml, (writeFileErr) => {
        if (writeFileErr) {
          reject(writeFileErr);
        } else {
          resolve();
        }
      });
    }
  });
});

export const compileSassAndPurgeCss = async ({ srcSassPath, destCssPath, sassSourceMap = true, purgeCssContent, cssFilesToPurge, purgeCssSourceMap = true }) => {
  if (!srcSassPath) throw new Error('No srcSassPath provided to compileSassAndPurgeCss');
  if (!destCssPath) throw new Error('No destCssPath provided to compileSassAndPurgeCss');
  console.log(`Rendering Sass to CSS from ${srcSassPath}`);

  // Legacy API for Dart Sass
  // Using this because it produces sourcemaps with relative paths, unlike `compile` method (although there is an option for relative paths in the command line interface)
  // `renderSync` is faster than `render`
  const sassResult = sass.renderSync({
    file: srcSassPath,
    outFile: destCssPath,
    sourceMap: sassSourceMap,
  });

  // // This is the main method for Dart Sass, but for some reason it only produces sourcemaps with absolute paths
  // const sassResult = sass.compile(srcSassPath, { sourceMap: sassSourceMap });

  const write = (fileInfo) => new Promise((resolve, reject) => {
    fs.writeFile(fileInfo.path, fileInfo.data, (err) => {
      if (err) {
        reject(err);
      }
      resolve();
    });
  });

  const cssFinished = write({ path: destCssPath, data: sassResult.css });
  let cssSourceMapFinished;
  if (sassSourceMap === true) {
    // cssSourceMapFinished = write({ path: `${destCssPath}.map`, data: JSON.stringify(sassResult.sourceMap) }); // For use with `sass.compile` method
    cssSourceMapFinished = write({ path: `${destCssPath}.map`, data: sassResult.map }); // For use with `sass.renderSync` method
  } else {
    cssSourceMapFinished = new Promise().resolve();
  }
  await Promise.all([cssFinished, cssSourceMapFinished]);

  // Purge CSS
  console.log(`Purging unused CSS for ${destCssPath}`);
  const purgeCssResults = await new PurgeCSS().purge({
    content: purgeCssContent,
    css: cssFilesToPurge,
    sourceMap: purgeCssSourceMap,
  });

  purgeCssResults.forEach(async (purgeCssResult) => {
    // Autoprefix CSS
    purgeCssResult.css = await new Promise((resolve) => {
      postcss([autoprefixer]).process(purgeCssResult.css).then((autoprefixedResult) => {
        autoprefixedResult.warnings().forEach((warn) => {
          console.warn(warn.toString());
        });
        resolve(autoprefixedResult.css);
      });
    });
    // Save file
    fs.writeFileSync(purgeCssResult.file, purgeCssResult.css, (err) => {
      if (err) {
        console.error(err);
      }
    });
  });
};

export const babelAndMinify = ({ inputPath, outputPath, minify = true }) => {
  if (!inputPath) throw new Error('No inputPath provided to babelAndMinify');
  if (!outputPath) throw new Error('No outputPath provided to babelAndMinify');
  // !! Still need to get source map input and output working
  return new Promise((resolve) => {
    const presets = ['@babel/env'];
    if (minify === true) {
      presets.push('minify');
    }
    transformFileAsync(inputPath, {
      presets,
      plugins: [
        ['@babel/transform-runtime'],
      ],
      // inputSourceMap: true,
      // sourceMaps: true,
    }).then((babelAndMinifyResult) => {
      fs.writeFile(outputPath, babelAndMinifyResult.code, (err) => {
        if (!err) {
          // File written on disk
          resolve();
        } else {
          console.log(err);
        }
      });
      // fs.writeFile(join(projectDir, 'dist/local/index.js.map'), babelAndMinifyResult.map, function (err) {
      //   if (!err) {
      //     // file written on disk
      //   } else {
      //     console.log(err);
      //   }
      // });
    });
  });
};

export const uglify = ({ inputPath, outputPath }) => new Promise((resolve, reject) => {
  if (!inputPath) reject(new Error('No input path provided to uglify'));
  if (!outputPath) reject(Error('No output path provided to uglify'));
  console.log(`Minifying ${inputPath}`);
  fs.readFile(inputPath, 'utf8', (err, data) => {
    if (err) reject(err);
    const uglifyOutput = UglifyJS.minify({ [path.basename(inputPath)]: data });
    fs.writeFile(outputPath, uglifyOutput.code, (uglifyOutputErr) => {
      if (uglifyOutputErr) reject(uglifyOutputErr);
      resolve();
    });
  });
});

export const beautifyHtml = ({ inputPath, outputPath }) => new Promise((resolve, reject) => {
  if (!inputPath) reject(new Error('No input path provided to beautifyHtml'));
  if (!outputPath) reject(new Error('No output path provided to beautifyHtml'));
  console.log(`Beautifying HTML for ${inputPath}`);
  fs.readFile(inputPath, 'utf8', (readFileErr, data) => {
    if (readFileErr) reject(readFileErr);
    const beautifiedHtml = pretty(data, { ocd: true });
    fs.writeFile(outputPath, beautifiedHtml, (writeFileErr) => {
      if (writeFileErr) reject(writeFileErr);
      resolve();
    });
  });
});

export const openInBrowser = ({ browser, path: openInBrowserPath }) => {
  // Open in browser
  exec(`open -a "${browser}" "${openInBrowserPath}"`, (err, stdout, stderr) => {
    if (stdout) console.log(stdout);
    if (stderr) console.log(stderr);
    if (err) throw err;
  });
};
