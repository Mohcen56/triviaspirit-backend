import type { ShowPropertyProps } from 'adminjs';
import React from 'react';

function mediaBaseUrl(custom: unknown): string {
  if (!custom || typeof custom !== 'object') return '';
  const value = (custom as Record<string, unknown>).mediaBaseUrl;
  return typeof value === 'string' ? value.replace(/\/$/, '') : '';
}

function mediaUrl(value: string, baseUrl: string): string | null {
  if (/^https?:\/\//i.test(value)) return value;
  if (!baseUrl) return null;
  const key = value.replace(/^\/?media\//, '').replace(/^\//, '');
  return `${baseUrl}/${key}`;
}

const MediaPreview = ({ property, record }: ShowPropertyProps) => {
  const rawValue: unknown = record.params[property.path];
  const value =
    typeof rawValue === 'string' || typeof rawValue === 'number'
      ? String(rawValue).trim()
      : '';
  const url = value ? mediaUrl(value, mediaBaseUrl(property.custom)) : null;

  return React.createElement(
    'div',
    { style: { marginBottom: '24px' } },
    React.createElement(
      'div',
      {
        style: {
          color: '#898a9a',
          fontSize: '14px',
          marginBottom: '6px',
        },
      },
      property.label,
    ),
    url
      ? React.createElement(
          'div',
          undefined,
          React.createElement(
            'a',
            {
              href: url,
              target: '_blank',
              rel: 'noopener noreferrer',
              title: 'Open full image',
            },
            React.createElement('img', {
              src: url,
              alt: property.label,
              loading: 'lazy',
              style: {
                display: 'block',
                maxWidth: '420px',
                maxHeight: '280px',
                objectFit: 'contain',
                borderRadius: '6px',
                border: '1px solid #dfe3e8',
                marginBottom: '8px',
              },
            }),
          ),
          React.createElement(
            'a',
            {
              href: url,
              target: '_blank',
              rel: 'noopener noreferrer',
              style: { color: '#4268f6', textDecoration: 'underline' },
            },
            'Open full image',
          ),
        )
      : React.createElement(
          'span',
          { style: { color: '#898a9a' } },
          value || 'No image',
        ),
  );
};

export default MediaPreview;
