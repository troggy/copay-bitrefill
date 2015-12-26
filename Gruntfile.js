'use strict';

module.exports = function (grunt) {

  grunt.loadNpmTasks('grunt-contrib-concat');
  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-html2js');
  grunt.loadNpmTasks('grunt-contrib-copy');
  grunt.loadNpmTasks('grunt-browserify');

  grunt.initConfig({
    clean: [ 
      'dist/templates.js'
    ],
    concat: {
      options: {
      },
      js: {
        src: [
          'src/js/copayBitrefill.js',
          'src/js/overrides/*.js',
          'src/js/controllers/*.js',
          'src/js/filters/*.js',
          'src/js/services/*.js',
          'src/js/directives/*.js',
          'dist/templates.js'
        ],
        dest: 'dist/js/copayBitrefill.js'
      },
      css: {
        src: ['src/css/*.css'],
        dest: 'dist/css/copayBitrefill.css'
      },
    },
    copy: {
      images: {
        expand: true,
        flatten: true,
        src: 'public/images/*',
        dest: 'dist/images/'
      },
    },
    html2js: {
      app: {
        options: {
          rename: function(moduleName) {
            return 'bitrefill/' + moduleName.replace('../', '');
          }
        },
        src: ['src/views/{,*/}*.html'],
        dest: 'dist/templates.js',
        module: 'copayBitrefill.views'
      }
    }
  });

  grunt.registerTask('default', [
    'html2js',
    'concat',
    'copy',
    'clean'
  ]);

};
