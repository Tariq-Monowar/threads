"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.baseUrl = exports.getImageUrl = void 0;
const getImageUrl = (imagePath) => {
    return `${process.env.BASE_URL}${imagePath}`;
};
exports.getImageUrl = getImageUrl;
exports.baseUrl = process.env.BASE_URL;
//# sourceMappingURL=baseurl.js.map