import xss from 'xss';

/**
 * Sanitizes user input by removing potentially harmful content
 * @param input The string to sanitize
 * @returns The sanitized string
 */
export const sanitizeInput = (input: string): string => {
  if (typeof input !== 'string') return '';
  
  // Remove any potential script tags and attributes
  input = input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<[^>]*>/g, ''); // Remove HTML tags
            
  // Sanitize using xss package
  input = xss(input.trim(), {
    whiteList: {}, // No HTML allowed
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script', 'style', 'xml'],
  });
  
  // Additional checks
  if (input.length > 1000) {
    input = input.substring(0, 1000);
  }
  
  return input;
}; 