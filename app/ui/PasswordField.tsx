'use client';

import { useState } from 'react';

type PasswordFieldProps = {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  minLength?: number;
  placeholder?: string;
  autoComplete?: string;
  name?: string;
  id?: string;
};

export default function PasswordField({
  value,
  onChange,
  required,
  minLength,
  placeholder,
  autoComplete,
  name,
  id
}: PasswordFieldProps) {
  const [show, setShow] = useState(false);
  return (
    <div className="password-field-wrap">
      <input
        id={id}
        name={name}
        value={value}
        onChange={e => onChange(e.target.value)}
        type={show ? 'text' : 'password'}
        required={required}
        minLength={minLength}
        placeholder={placeholder}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setShow(prev => !prev)}
        aria-label={show ? 'Hide password' : 'Show password'}
        title={show ? 'Hide password' : 'Show password'}
      >
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}
