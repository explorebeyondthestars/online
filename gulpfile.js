const { watch } = require('gulp');
const fs = require('fs');

function test(cb) {
    console.log('updated.');
}

exports.default = function() {
    watch("gitlog.txt", test);
};