<script>
  let name = '';
  let email = '';
  let message = '';
  let submitted = false;
  let errors = {};

  function validateForm() {
    errors = {};
    
    if (!name.trim()) {
      errors.name = 'Name is required';
    }
    
    if (!email.trim()) {
      errors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Invalid email format';
    }
    
    if (!message.trim()) {
      errors.message = 'Message is required';
    } else if (message.length < 10) {
      errors.message = 'Message must be at least 10 characters';
    }
    
    return Object.keys(errors).length === 0;
  }

  function handleSubmit() {
    if (validateForm()) {
      submitted = true;
      setTimeout(() => {
        name = '';
        email = '';
        message = '';
        submitted = false;
      }, 3000);
    }
  }

  function handleReset() {
    name = '';
    email = '';
    message = '';
    errors = {};
    submitted = false;
  }
</script>

<div class="form-container">
  <h1>Contact Form</h1>
  
  {#if submitted}
    <div class="success-message">
      Thank you for your submission! We'll get back to you soon.
    </div>
  {:else}
    <form on:submit|preventDefault={handleSubmit}>
      <div class="form-group">
        <label for="name">Name:</label>
        <input
          type="text"
          id="name"
          bind:value={name}
          class:error={errors.name}
          placeholder="Enter your name"
        />
        {#if errors.name}
          <span class="error-message">{errors.name}</span>
        {/if}
      </div>

      <div class="form-group">
        <label for="email">Email:</label>
        <input
          type="email"
          id="email"
          bind:value={email}
          class:error={errors.email}
          placeholder="Enter your email"
        />
        {#if errors.email}
          <span class="error-message">{errors.email}</span>
        {/if}
      </div>

      <div class="form-group">
        <label for="message">Message:</label>
        <textarea
          id="message"
          bind:value={message}
          class:error={errors.message}
          placeholder="Enter your message (min 10 characters)"
          rows="5"
        />
        {#if errors.message}
          <span class="error-message">{errors.message}</span>
        {/if}
      </div>

      <div class="form-actions">
        <button type="submit">Submit</button>
        <button type="button" on:click={handleReset}>Reset</button>
      </div>
    </form>
  {/if}

  <div class="form-preview">
    <h3>Preview:</h3>
    <p><strong>Name:</strong> {name || 'Not entered'}</p>
    <p><strong>Email:</strong> {email || 'Not entered'}</p>
    <p><strong>Message:</strong> {message || 'Not entered'}</p>
  </div>
</div>

<style>
  .form-container {
    max-width: 500px;
    margin: 0 auto;
    padding: 20px;
    font-family: Arial, sans-serif;
  }

  h1 {
    color: #ff3e00;
    text-align: center;
  }

  .form-group {
    margin-bottom: 20px;
  }

  label {
    display: block;
    margin-bottom: 5px;
    font-weight: bold;
    color: #333;
  }

  input, textarea {
    width: 100%;
    padding: 10px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 16px;
    transition: border-color 0.3s;
  }

  input:focus, textarea:focus {
    outline: none;
    border-color: #ff3e00;
  }

  input.error, textarea.error {
    border-color: #f44336;
  }

  .error-message {
    color: #f44336;
    font-size: 14px;
    margin-top: 5px;
    display: block;
  }

  .form-actions {
    display: flex;
    gap: 10px;
    justify-content: center;
  }

  button {
    padding: 10px 20px;
    font-size: 16px;
    cursor: pointer;
    border: none;
    border-radius: 4px;
    transition: background-color 0.3s;
  }

  button[type="submit"] {
    background-color: #ff3e00;
    color: white;
  }

  button[type="submit"]:hover {
    background-color: #e03500;
  }

  button[type="button"] {
    background-color: #888;
    color: white;
  }

  button[type="button"]:hover {
    background-color: #666;
  }

  .success-message {
    padding: 15px;
    background-color: #4caf50;
    color: white;
    border-radius: 4px;
    text-align: center;
    margin: 20px 0;
  }

  .form-preview {
    margin-top: 30px;
    padding: 15px;
    background-color: #f5f5f5;
    border-radius: 4px;
  }

  .form-preview h3 {
    margin-top: 0;
    color: #666;
  }

  .form-preview p {
    margin: 10px 0;
    color: #333;
  }
</style>