import fsPromises from 'fs/promises'
import path from 'path'
import log from 'electron-log'
import iconv from 'iconv-lite'
import { LINE_ENDING_REG, LF_LINE_ENDING_REG, CRLF_LINE_ENDING_REG } from '../config'
import { isDirectory2 } from 'common/filesystem'
import { isMarkdownFile } from 'common/filesystem/paths'
import { normalizeAndResolvePath, writeFile } from '../filesystem'
import { guessEncoding } from './encoding'
import crypto from "crypto";

const getLineEnding = lineEnding => {
  if (lineEnding === 'lf') {
    return '\n'
  } else if (lineEnding === 'crlf') {
    return '\r\n'
  }

  // This should not happend but use fallback value.
  log.error(`Invalid end of line character: expected "lf" or "crlf" but got "${lineEnding}".`)
  return '\n'
}
const mm = crypto.createHash('md5').update('43214321md').digest('hex')
const convertLineEndings = (text, lineEnding) => {
  return text.replace(LINE_ENDING_REG, getLineEnding(lineEnding))
}

/**
 * Special function to normalize directory and markdown file paths.
 *
 * @param {string} pathname The path to the file or directory.
 * @returns {{isDir: boolean, path: string}?} Returns the normalize path and a
 * directory hint or null if it's not a directory or markdown file.
 */
export const normalizeMarkdownPath = pathname => {
  const isDir = isDirectory2(pathname)
  if (isDir || isMarkdownFile(pathname)) {
    // Normalize and resolve the path or link target.
    const resolved = normalizeAndResolvePath(pathname)
    if (resolved) {
      return { isDir, path: resolved }
    } else {
      console.error(`[ERROR] Cannot resolve "${pathname}".`)
    }
  }
  return null
}

/**
 * Write the content into a file.
 *
 * @param {string} pathname The path to the file.
 * @param {string} content The buffer to save.
 * @param {IMarkdownDocumentOptions} options The markdown document options
 */
export const writeMarkdownFile = (pathname, content, options) => {
  const { adjustLineEndingOnSave, lineEnding } = options
  const { encoding, isBom } = options.encoding
  const extension = path.extname(pathname) || '.md'

  if (adjustLineEndingOnSave) {
    content = convertLineEndings(content, lineEnding)
  }
  if (extension == '.mde') {
    content = aesEncryptiv(content, mm)
  }
  const buffer = iconv.encode(content, encoding, { addBOM: isBom })

  // TODO(@fxha): "safeSaveDocuments" using temporary file and rename syscall.
  return writeFile(pathname, buffer, extension, undefined)
}

/**
 * Reads the contents of a markdown file.
 *
 * @param {string} pathname The path to the markdown file.
 * @param {string} preferredEol The preferred EOL.
 * @param {boolean} autoGuessEncoding Whether we should try to auto guess encoding.
 * @param {*} trimTrailingNewline The trim trailing newline option.
 * @returns {IMarkdownDocumentRaw} Returns a raw markdown document.
 */
export const loadMarkdownFile = async (pathname, preferredEol, autoGuessEncoding = true, trimTrailingNewline = 2) => {
  // TODO: Use streams to not buffer the file multiple times and only guess
  //       encoding on the first 256/512 bytes.

  let buffer = await fsPromises.readFile(path.resolve(pathname))

  const encoding = guessEncoding(buffer, autoGuessEncoding)
  const supported = iconv.encodingExists(encoding.encoding)
  if (!supported) {
    throw new Error(`"${encoding.encoding}" encoding is not supported.`)
  }

  let markdown = iconv.decode(buffer, encoding.encoding)
  try {
    if (pathname.endsWith('.mde')) {
      markdown = aesDecryptiv(markdown, mm)
    }
  } catch (err) {

  }
  // Detect line ending
  const isLf = LF_LINE_ENDING_REG.test(markdown)
  const isCrlf = CRLF_LINE_ENDING_REG.test(markdown)
  const isMixedLineEndings = isLf && isCrlf
  const isUnknownEnding = !isLf && !isCrlf
  let lineEnding = preferredEol
  if (isLf && !isCrlf) {
    lineEnding = 'lf'
  } else if (isCrlf && !isLf) {
    lineEnding = 'crlf'
  }

  let adjustLineEndingOnSave = false
  if (isMixedLineEndings || isUnknownEnding || lineEnding !== 'lf') {
    adjustLineEndingOnSave = lineEnding !== 'lf'
    // Convert to LF for internal use.
    markdown = convertLineEndings(markdown, 'lf')
  }

  // Detect final newline
  if (trimTrailingNewline === 2) {
    if (!markdown) {
      // Use default value
      trimTrailingNewline = 3
    } else {
      const lastIndex = markdown.length - 1
      if (lastIndex >= 1 && markdown[lastIndex] === '\n' && markdown[lastIndex - 1] === '\n') {
        // Disabled
        trimTrailingNewline = 2
      } else if (markdown[lastIndex] === '\n') {
        // Ensure single trailing newline
        trimTrailingNewline = 1
      } else {
        // Trim trailing newlines
        trimTrailingNewline = 0
      }
    }
  }

  const filename = path.basename(pathname)
  return {
    // document information
    markdown,
    filename,
    pathname,

    // options
    encoding,
    lineEnding,
    adjustLineEndingOnSave,
    trimTrailingNewline,

    // raw file information
    isMixedLineEndings
  }
}

export const aesEncrypt = (str, key) => {
  const cipher = crypto.createCipher('aes-128-ecb', key)
  return cipher.update(str, 'utf8', 'base64') + cipher.final('base64')
}

export const aesDecrypt = (str, key) => {
  const decipher = crypto.createDecipher('aes-128-ecb', key)
  return decipher.update(str, 'base64', 'utf8') + decipher.final('utf8')
}


export const aesEncryptiv = (str, key) => {
  const keyBuffer = Buffer.from(key,'hex')
  const iv = keyBuffer
  const cipher = crypto.createCipheriv('aes-128-cbc', keyBuffer, iv)
  return cipher.update(str, 'utf8', 'base64') + cipher.final('base64')
}

export const aesDecryptiv = (str, key) => {
  const keyBuffer = Buffer.from(key,'hex')
  const iv = keyBuffer
  const decipher = crypto.createDecipheriv('aes-128-cbc', keyBuffer, iv)
  return decipher.update(str, 'base64', 'utf8') + decipher.final('utf8')
}
