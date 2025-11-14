/**
 * Enhanced File Validation Utilities for GPTHost
 * Provides comprehensive security and usability validation for uploaded files
 */

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean;
  errorCode?: string;
  message?: string;
  details?: Record<string, any>;
}

/**
 * File validation configuration
 */
export interface ValidationConfig {
  maxFileSize: number;
  supportedExtensions: string[];
}

/**
 * Dangerous file extensions that pose security risks
 */
const DANGEROUS_EXTENSIONS = [
  // Windows executables
  '.exe', '.bat', '.cmd', '.com', '.scr', '.pif', '.vbs', '.vbe', '.jse',
  '.msi', '.cab', '.dll', '.sys', '.drv', '.cpl', '.ocx', '.ax', '.inf',
  
  // Unix/Linux executables
  '.sh', '.bash', '.zsh', '.csh', '.ksh', '.fish', '.run', '.bin', '.out',
  '.elf', '.so', '.a', '.o', '.ko',
  
  // Cross-platform executables/scripts
  '.jar', '.app', '.deb', '.rpm', '.dmg', '.pkg', '.ipa', '.apk',
  '.ps1', '.psm1', '.ps1xml', '.psc1', '.psd1', '.pssc', '.psrc',
  '.py', '.pl', '.rb', '.php', '.asp', '.aspx', '.jsp', '.cgi'
];

/**
 * Dangerous MIME types that should be rejected
 */
const DANGEROUS_MIME_TYPES = [
  'application/x-executable', 'application/x-msdownload', 'application/x-msdos-program',
  'application/x-mach-binary', 'application/x-elf', 'application/x-sharedlib',
  'application/java-archive', 'application/x-java-archive', 'application/x-jar',
  'application/vnd.android.package-archive', 'application/x-ios-app',
  'application/x-debian-package', 'application/x-redhat-package-manager',
  'application/x-apple-diskimage', 'application/x-newton-compatible-pkg',
  'text/x-shellscript', 'application/x-sh', 'application/x-csh',
  'text/x-python', 'text/x-perl', 'text/x-ruby', 'text/x-php',
  'application/x-httpd-php', 'text/x-script.phyton'
];

/**
 * Expected MIME types for supported extensions
 */
const EXTENSION_MIME_MAP: Record<string, string[]> = {
  '.html': ['text/html', 'application/octet-stream'],
  '.htm': ['text/html', 'application/octet-stream'],
  '.jsx': ['text/javascript', 'application/javascript', 'text/jsx', 'application/octet-stream'],
  '.tsx': ['text/typescript', 'application/typescript', 'text/tsx', 'application/octet-stream'],
  '.vue': ['text/plain', 'text/x-vue', 'application/javascript', 'application/octet-stream'],
  '.svelte': ['text/plain', 'text/x-svelte', 'application/javascript', 'application/octet-stream']
};

/**
 * File magic numbers for content-based validation
 */
const MAGIC_NUMBERS: Array<{ signature: number[]; type: string; description: string; extraValidation?: string }> = [
  // Windows PE executables
  { signature: [0x4D, 0x5A], type: 'exe', description: 'Windows PE executable' },
  // ELF binaries
  { signature: [0x7F, 0x45, 0x4C, 0x46], type: 'elf', description: 'ELF binary' },
  // Mach-O binaries (macOS)
  { signature: [0xFE, 0xED, 0xFA, 0xCE], type: 'macho32', description: 'Mach-O 32-bit binary' },
  { signature: [0xFE, 0xED, 0xFA, 0xCF], type: 'macho64', description: 'Mach-O 64-bit binary' },
  { signature: [0xCF, 0xFA, 0xED, 0xFE], type: 'macho32le', description: 'Mach-O 32-bit binary (little endian)' },
  { signature: [0xCF, 0xFA, 0xED, 0xFF], type: 'macho64le', description: 'Mach-O 64-bit binary (little endian)' },
  // Java class files
  { signature: [0xCA, 0xFE, 0xBA, 0xBE], type: 'java', description: 'Java class file' },
  // ZIP files - generic ZIP signature
  { signature: [0x50, 0x4B, 0x03, 0x04], type: 'zip', description: 'ZIP archive' },
  // Executable JAR files - check for Java-specific content
  { signature: [0x50, 0x4B, 0x03, 0x04], type: 'jar', description: 'Java JAR archive', extraValidation: 'jar' }
];

/**
 * Validate filename for suspicious patterns
 */
export function validateFilename(filename: string): ValidationResult {
  // Check for empty filename
  if (!filename || filename.trim().length === 0) {
    return {
      isValid: false,
      errorCode: 'EMPTY_FILENAME',
      message: 'Filename cannot be empty'
    };
  }

  // Check for null bytes or other control characters
  if (/[\x00-\x1F\x7F]/.test(filename)) {
    return {
      isValid: false,
      errorCode: 'SUSPICIOUS_FILENAME',
      message: 'Filename contains invalid characters',
      details: { filename, reason: 'Control characters detected' }
    };
  }

  // Check for path traversal attempts
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return {
      isValid: false,
      errorCode: 'SUSPICIOUS_FILENAME',
      message: 'Filename contains suspicious path traversal patterns',
      details: { filename, reason: 'Path traversal detected' }
    };
  }

  // Check for multiple extensions (e.g., file.txt.exe)
  const extensionMatches = filename.match(/\.[^.]+/g);
  if (extensionMatches && extensionMatches.length > 1) {
    const lastExtension = extensionMatches[extensionMatches.length - 1].toLowerCase();
    if (DANGEROUS_EXTENSIONS.includes(lastExtension)) {
      return {
        isValid: false,
        errorCode: 'SUSPICIOUS_FILE_EXTENSION',
        message: 'File has multiple extensions with dangerous final extension',
        details: { filename, extensions: extensionMatches, dangerousExtension: lastExtension }
      };
    }
  }

  return { isValid: true };
}

/**
 * Validate file extension against security risks
 */
export function validateFileExtension(filename: string, supportedExtensions: string[]): ValidationResult {
  const fileExtension = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
  
  if (!fileExtension) {
    return {
      isValid: false,
      errorCode: 'NO_FILE_EXTENSION',
      message: 'File must have a valid extension',
      details: { filename, supported: supportedExtensions }
    };
  }


  // Check if extension is supported first (before dangerous check for better UX)
  if (!supportedExtensions.includes(fileExtension)) {
    // Check if it's dangerous after determining it's unsupported
    if (DANGEROUS_EXTENSIONS.includes(fileExtension)) {
      return {
        isValid: false,
        errorCode: 'SECURITY_RISK_FILE_TYPE',
        message: `File type ${fileExtension} is a security risk and cannot be uploaded`,
        details: { 
          filename, 
          extension: fileExtension, 
          reason: 'Potentially executable file type',
          suggestion: 'Only upload web component files (.jsx, .tsx, .vue, .svelte, .html)'
        }
      };
    }

    // Provide helpful suggestions for common mistakes (non-dangerous files)
    let suggestion = '';
    if (fileExtension === '.js' && supportedExtensions.includes('.jsx')) {
      suggestion = 'Did you mean to upload a .jsx file for React components?';
    } else if (fileExtension === '.ts' && supportedExtensions.includes('.tsx')) {
      suggestion = 'Did you mean to upload a .tsx file for React components?';
    }

    return {
      isValid: false,
      errorCode: 'UNSUPPORTED_FILE_TYPE',
      message: `Unsupported file type. File ${filename} has unsupported extension. Supported: ${supportedExtensions.join(', ')}${suggestion ? ` ${suggestion}` : ''}`,
      details: { filename, extension: fileExtension, supported: supportedExtensions, suggestion }
    };
  }

  return { isValid: true };
}

/**
 * Validate MIME type against file extension and security risks
 */
export function validateMimeType(filename: string, mimeType: string, supportedExtensions?: string[]): ValidationResult {
  // Skip MIME validation for unsupported extensions to avoid confusing error messages
  const fileExtension = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (supportedExtensions && fileExtension && !supportedExtensions.includes(fileExtension)) {
    return { isValid: true }; // Let extension validation handle this
  }
  
  // Validate MIME type consistency with file extension first (more specific error)
  if (fileExtension && EXTENSION_MIME_MAP[fileExtension]) {
    const expectedMimes = EXTENSION_MIME_MAP[fileExtension];
    if (!expectedMimes.includes(mimeType.toLowerCase())) {
      return {
        isValid: false,
        errorCode: 'MIME_TYPE_MISMATCH',
        message: `MIME type ${mimeType} does not match expected types for ${fileExtension} files`,
        details: { 
          filename, 
          mimeType, 
          extension: fileExtension, 
          expectedMimes,
          reason: 'File type spoofing detected'
        }
      };
    }
  }

  // Check for dangerous MIME types (after checking extension consistency)
  if (DANGEROUS_MIME_TYPES.includes(mimeType.toLowerCase())) {
    return {
      isValid: false,
      errorCode: 'DANGEROUS_MIME_TYPE',
      message: `File has dangerous MIME type: ${mimeType}`,
      details: { filename, mimeType, reason: 'Potentially executable content type' }
    };
  }

  return { isValid: true };
}

/**
 * Enhanced validation for potential JAR files
 * Checks if a ZIP file contains Java-specific content that indicates it's an executable JAR
 */
async function validateJarContent(file: File): Promise<ValidationResult> {
  try {
    // Read more of the file to analyze ZIP structure
    const buffer = await file.slice(0, 1024).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    
    // Convert to string for pattern matching
    const content = new TextDecoder('ascii', { fatal: false }).decode(bytes);
    
    // Look for JAR-specific indicators
    const jarIndicators = [
      'META-INF/MANIFEST.MF',  // JAR manifest file
      '.class',                // Java class files
      'Main-Class:',          // Executable JAR main class
      'Class-Path:',          // JAR classpath
    ];
    
    const foundIndicators = jarIndicators.filter(indicator => content.includes(indicator));
    
    if (foundIndicators.length > 0) {
      return {
        isValid: false,
        errorCode: 'EXECUTABLE_JAR_DETECTED',
        message: 'File appears to be an executable JAR archive',
        details: { 
          filename: file.name, 
          detectedType: 'jar',
          jarIndicators: foundIndicators,
          reason: 'Contains Java executable content'
        }
      };
    }
    
    return { isValid: true };
  } catch (error) {
    // If we can't analyze the content, be permissive but log
    console.warn('Could not validate JAR content:', error);
    return { isValid: true };
  }
}

/**
 * Validate file content for executable signatures
 */
export async function validateFileContent(file: File): Promise<ValidationResult> {
  try {
    // Read first 16 bytes to check magic numbers
    const buffer = await file.slice(0, 16).arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Check against known executable magic numbers
    for (const magic of MAGIC_NUMBERS) {
      if (bytes.length >= magic.signature.length) {
        const matches = magic.signature.every((byte, index) => bytes[index] === byte);
        if (matches) {
          // Handle ZIP/JAR detection specially
          if (magic.extraValidation === 'jar') {
            const jarValidation = await validateJarContent(file);
            if (!jarValidation.isValid) {
              return jarValidation;
            }
            // If JAR validation passes, continue checking (it might be a legitimate ZIP)
            continue;
          }
          
          // Handle ZIP files - allow legitimate ZIPs but be cautious
          if (magic.type === 'zip') {
            // Check file extension to provide context
            const fileExtension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
            if (fileExtension === '.jar') {
              return {
                isValid: false,
                errorCode: 'EXECUTABLE_CONTENT_DETECTED',
                message: 'JAR files are not allowed for security reasons',
                details: { 
                  filename: file.name, 
                  detectedType: 'jar',
                  description: 'Java JAR archive',
                  reason: 'JAR files can contain executable Java code'
                }
              };
            }
            // Allow other ZIP files (might contain source code/documentation)
            continue;
          }

          // Block all other executable content
          return {
            isValid: false,
            errorCode: 'EXECUTABLE_CONTENT_DETECTED',
            message: `File contains executable content: ${magic.description}`,
            details: { 
              filename: file.name, 
              detectedType: magic.type,
              description: magic.description,
              reason: 'Binary executable content detected'
            }
          };
        }
      }
    }

    return { isValid: true };
  } catch (error) {
    // If we can't read the file content, allow it through but log the issue
    console.warn('Could not validate file content:', error);
    return { isValid: true };
  }
}

/**
 * Validate file size
 */
export function validateFileSize(file: File, maxFileSize: number): ValidationResult {
  if (file.size === 0) {
    return {
      isValid: false,
      errorCode: 'EMPTY_FILE',
      message: 'Cannot upload empty file',
      details: { filename: file.name, size: file.size }
    };
  }

  if (file.size > maxFileSize) {
    return {
      isValid: false,
      errorCode: 'FILE_TOO_LARGE',
      message: `File ${file.name} exceeds maximum size of ${maxFileSize} bytes`,
      details: { 
        filename: file.name, 
        fileSize: file.size, 
        maxSize: maxFileSize 
      }
    };
  }

  return { isValid: true };
}

/**
 * Comprehensive file validation function
 */
export async function validateFile(file: File, config: ValidationConfig): Promise<ValidationResult> {
  // 1. Validate filename
  const filenameResult = validateFilename(file.name);
  if (!filenameResult.isValid) {
    return filenameResult;
  }

  // 2. Validate file size
  const sizeResult = validateFileSize(file, config.maxFileSize);
  if (!sizeResult.isValid) {
    return sizeResult;
  }

  // 3. Validate file extension first (for better user experience)
  const extensionResult = validateFileExtension(file.name, config.supportedExtensions);
  if (!extensionResult.isValid) {
    return extensionResult;
  }

  // 4. Validate MIME type (after extension check for supported files)
  const mimeResult = validateMimeType(file.name, file.type, config.supportedExtensions);
  if (!mimeResult.isValid) {
    return mimeResult;
  }

  // 5. Validate file content
  const contentResult = await validateFileContent(file);
  if (!contentResult.isValid) {
    return contentResult;
  }

  return { isValid: true };
}