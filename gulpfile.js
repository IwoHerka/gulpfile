/*
 * General purpose gulpfile
 *
 *   |-- assets
 *   |   |-- fonts
 *   |   |-- images
 *   |   |-- scripts
 *   |   |    `-- coffee
 *   |   |-- styles
 *   |   `-- manifest.json
 *   |-- static
 *   |   |-- dist
 *   |   `-- local
 *   |-- templates
 *   `-- gulpfile.js
 *
 * Run `gulp -T` for a task summary
 * Run `gulp show` for configuration summary
 */

var gulp         = require('gulp'),
    argv         = require('minimist')(process.argv.slice(2)),
    // Parse CSS and add vendor prefixes to CSS rules
    autoprefixer = require('gulp-autoprefixer'),
    // Only pass through changed files:
    changed     = require('gulp-changed'),
    // Concatenates files
    concat      = require('gulp-concat'),
    // Remove or replace relative path for files
    flatten     = require('gulp-flatten'),
    // Run tasks conditionally
    gulpif      = require('gulp-if'),
    // Minify images
    imagemin    = require('gulp-imagemin'),
    // Check and debug JavaScript
    jshint      = require('gulp-jshint'),
    coffeelint  = require('gulp-coffeelint'),
    // Create an immutable, lazily initialized pipeline
    lazypipe    = require('lazypipe'),
    // Compile .less to .css
    less        = require('gulp-less'),
    // Merge (interleave) a bunch of streams.
    merge       = require('merge-stream'),
    // Minify .css
    cssnano     = require('gulp-cssnano'),
    // Prevent pipe breaking caused by errors from gulp plugins
    plumber     = require('gulp-plumber'),
    // Static asset revisioning by appending content hash to filenames
    rev         = require('gulp-rev'),
    // Run a series of dependent gulp tasks in order
    runsequence = require('run-sequence'),
    // Compile .scss to .css
    sass        = require('gulp-sass'),
    sourcemaps  = require('gulp-sourcemaps'),
    gutil       = require('gulp-util'),
    uglify      = require('gulp-uglify'),
    // Compile .coffee to .js
    coffee      = require('gulp-coffee'),
    collector   = require('gulp-rev-collector');

// See https://github.com/austinpray/asset-builder
var manifest = require('asset-builder')('./assets/manifest.json');

/*
 * `path` - Paths to base asset directories. With trailing slashes.
 * - `path.source` - Path to the source files. Default: `assets/`
 * - `path.dist` - Path to the build directory. Default: `dist/`
 */
var path = manifest.paths;

// `config` - Store arbitrary configuration values here.
var config = manifest.config || {};

/*
 * `globs` - These ultimately end up in their respective `gulp.src`.
 * - `globs.js` - Array of asset-builder JS dependency objects. Example:
 *
 * {type: 'js', name: 'main.js', globs: []}
 *
 * - `globs.css` - Array of asset-builder CSS dependency objects. Example:
 *
 * {type: 'css', name: 'main.css', globs: []}
 *
 * - `globs.fonts` - Array of font path globs.
 * - `globs.images` - Array of image path globs.
 * - `globs.bower` - Array of all the main Bower files.
 */
var globs = manifest.globs;

/*
 * `project` - paths to first-party assets.
 * - `project.js` - Array of first-party JS assets.
 * - `project.css` - Array of first-party CSS assets.
 */
var project = manifest.getProjectGlobs();

/*
 * `gulp show` - Show configuration summary
 */
gulp.task('show', function() {
  gutil.log('paths:\n', path);
  gutil.log('config:\n', config);
  gutil.log('globs:\n', globs);
  gutil.log('project:\n', project);
});

/*
 * CLI options
 */
var enabled = {
  // Enable static asset revisioning when `--production`
  rev: argv.production,
  // Minify only in production
  minify: argv.production,
  // Disable source maps when `--production`
  maps: !argv.production,
  // Fail styles task on error when `--production`
  failStyleTask: argv.production,
  // Fail due to JSHint warnings only when `--production`
  failJSHint: argv.production,
  // Strip debug statments from javascript when `--production`
  stripJSDebug: argv.production
};

// Path to the compiled assets manifest in the dist directory
var buildPath = argv.production ? path.dist : path.local;
var revManifest = buildPath + 'assets.json';

/*
 * Reusable Pipelines
 * See https://github.com/OverZealous/lazypipe
 *
 * CSS processing pipeline. Example:
 * gulp.src(cssFiles)
 *   .pipe(cssTasks('main.css')
 *   .pipe(gulp.dest(path.dist + 'styles'))
 */
var cssTasks = function(filename) {
  return lazypipe()
    .pipe(function() {
      return gulpif(!enabled.failStyleTask, plumber());
    })
    .pipe(function() {
      return gulpif(enabled.maps, sourcemaps.init());
    })
    .pipe(function() {
      return gulpif('*.less', less());
    })
    .pipe(function() {
      return gulpif('*.scss', sass({
        outputStyle: 'nested', // libsass doesn't support expanded yet
        precision: 10,
        includePaths: ['.'],
        errLogToConsole: !enabled.failStyleTask
      }));
    })
    .pipe(concat, filename)
    .pipe(autoprefixer, {
      browsers: [
        'last 2 versions',
        'android 4',
        'opera 12'
      ]
    })
    .pipe(function() {
      return gulpif(enabled.minify, cssnano());
    })
    .pipe(function() {
      return gulpif(enabled.rev, rev());
    })
    .pipe(function() {
      return gulpif(enabled.maps, sourcemaps.write('.', {
        sourceRoot: 'assets/styles/'
      }));
    })();
};

/*
 * JS processing pipeline. Example:
 * gulp.src(jsFiles)
 *   .pipe(jsTasks('main.js')
 *   .pipe(gulp.dest(path.dist + 'scripts'))
 */
var jsTasks = function(filename) {
  return lazypipe()
    .pipe(function() {
      return gulpif(enabled.maps, sourcemaps.init());
    })
    .pipe(concat, filename)
    .pipe(function() {
      return gulpif(enabled.minify, uglify({
        compress: {
          'drop_debugger': enabled.stripJSDebug
        }
      }));
    })
    .pipe(function() {
      return gulpif(enabled.rev, rev());
    })
    .pipe(function() {
      return gulpif(enabled.maps, sourcemaps.write('.', {
        sourceRoot: 'assets/scripts/'
      }));
    })();
};

/*
 * If there are any revved files then write them to the rev manifest.
 * See https://github.com/sindresorhus/gulp-rev
 */
var writeToManifest = function(directory) {
  return lazypipe()
    .pipe(gulp.dest, buildPath + directory)
    .pipe(rev.manifest, revManifest, {
      base: buildPath,
      merge: true
    })
    .pipe(gulp.dest, buildPath)();
};

/*
 * `gulp styles` - Compiles, combines, and optimizes Bower CSS and project CSS.
 * By default this task will only log a warning if a precompiler error is
 * raised. If the `--production` flag is set: this task will fail outright.
 */
gulp.task('styles', ['wiredep'], function() {
  var merged = merge();
  manifest.forEachDependency('css', function(dep) {
    var cssTasksInstance = cssTasks(dep.name);
    if (!enabled.failStyleTask) {
      cssTasksInstance.on('error', function(err) {
        console.error(err.message);
        this.emit('end');
      });
    }
    merged.add(gulp.src(dep.globs, {base: 'styles'})
      .pipe(cssTasksInstance));
  });
  return merged
    .pipe(writeToManifest('styles'));
});

/*
 * `gulp scripts` - Runs JSHint then compiles, combines,
 * and optimizes Bower JS and project JS.
 */
gulp.task('scripts', ['jshint', 'coffee'], function() {
  var merged = merge();
  manifest.forEachDependency('js', function(dep) {
    merged.add(
      gulp.src(dep.globs, {base: 'scripts'})
        .pipe(jsTasks(dep.name))
    );
  });
  return merged
    .pipe(writeToManifest('scripts'));
});

/*
 * `gulp fonts` - Grabs all the fonts and outputs them in a flattened directory
 * structure. See: https://github.com/armed/gulp-flatten
 */
gulp.task('fonts', function() {
  return gulp.src(globs.fonts)
    .pipe(flatten())
    .pipe(gulp.dest(buildPath + 'fonts'));
});

/*
 * `gulp images` - Run lossless compression on all the images.
 */
gulp.task('images', function() {
  return gulp.src(globs.images)
    .pipe(imagemin({
      progressive: true,
      interlaced: true,
      svgoPlugins: [{removeUnknownsAndDefaults: false}, {cleanupIDs: false}]
    }))
    .pipe(gulp.dest(buildPath + 'images'));
});

/*
 * `gulp jshint` - Lints configuration JSON
 */
gulp.task('jshint', function() {
  return gulp.src([
    'package.json', 'bower.json', 'gulpfile.js'
  ])
  .pipe(jshint())
  .pipe(jshint.reporter('jshint-stylish'))
  .pipe(gulpif(enabled.failJSHint, jshint.reporter('fail')));
});

/*
 * `gulp coffeelint` - Lints project .coffee
 */
gulp.task('coffeelint', function() {
  return gulp.src(path.coffee + '*.coffee')
  .pipe(coffeelint())
  .pipe(coffeelint.reporter());
});

/*
 * `gulp coffee` - Compile project .coffee to .js
 */
gulp.task('coffee', ['coffeelint'], function() {
  return gulp.src(path.coffee + '*.coffee')
  .pipe(coffee({bare: true}).on('error', gutil.log))
  .pipe(gulp.dest(path.scripts));
});

/*
 * `gulp collect-rev` - Find static revisioned data and
 * replace its links in html template.
 * See https://github.com/shonny-ua/gulp-rev-collector
 */
gulp.task('collect-rev', function () {
  return gulp.src([buildPath + '*.json', 'templates/**/*.html'])
    .pipe(collector())
    .pipe(gulp.dest(path.templates));
});

/*
 * `gulp clean` - Deletes the build folder entirely.
 */
gulp.task('clean', require('del').bind(null, [buildPath]));

/*
 * `gulp watch` - Use BrowserSync to proxy your dev server and synchronize code
 * changes across devices. Specify the hostname of your dev server at
 * `manifest.config.devUrl`. When a modification is made to an asset, run the
 * build step for that asset and inject the changes into the page.
 * See: http://www.browsersync.io
 */
gulp.task('watch', function() {
  gulp.watch([path.source + 'styles/**/*'], ['styles']);
  gulp.watch([path.source + 'scripts/**/*'], ['coffeelint', 'scripts']);
  gulp.watch([path.source + 'fonts/**/*'], ['fonts']);
  gulp.watch([path.source + 'images/**/*'], ['images']);
  gulp.watch(['bower.json', 'assets/manifest.json'], ['build']);
});

/*
 * `gulp build` - Run all the build tasks but don't clean up beforehand.
 * Generally you should be running `gulp` instead of `gulp build`.
 */
gulp.task('build', function(callback) {
  runsequence(
    'styles',
    'scripts',
    ['fonts', 'images'],
    'collect-rev',
    callback
  );
});

/*
 * `gulp wiredep` - Automatically inject Less and Sass Bower dependencies.
 * See https://github.com/taptapship/wiredep
 */
gulp.task('wiredep', function() {
  var wiredep = require('wiredep').stream;
  return gulp.src(project.css)
    .pipe(wiredep())
    .pipe(changed(path.source + 'styles', {
        hasChanged: changed.compareSha1Digest
    }))
    .pipe(gulp.dest(path.source + 'styles'));
});

/*
 * `gulp` - Run a complete build. To compile for production run `gulp --production`.
 */
gulp.task('default', ['clean'], function() {
  gulp.start('build');
});
