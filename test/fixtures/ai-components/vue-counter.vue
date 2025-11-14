<template>
  <div class="counter-container">
    <h1>Vue Counter App</h1>
    <div class="counter-display">
      <p class="count">{{ count }}</p>
    </div>
    <div class="controls">
      <button @click="decrement" :disabled="count <= 0">-</button>
      <button @click="reset">Reset</button>
      <button @click="increment">+</button>
    </div>
    <div class="history">
      <h3>History</h3>
      <ul>
        <li v-for="(entry, index) in history" :key="index">
          {{ entry }}
        </li>
      </ul>
    </div>
  </div>
</template>

<script>
export default {
  name: 'Counter',
  data() {
    return {
      count: 0,
      history: []
    };
  },
  methods: {
    increment() {
      this.count++;
      this.addToHistory(`Incremented to ${this.count}`);
    },
    decrement() {
      if (this.count > 0) {
        this.count--;
        this.addToHistory(`Decremented to ${this.count}`);
      }
    },
    reset() {
      this.count = 0;
      this.addToHistory('Reset to 0');
    },
    addToHistory(action) {
      this.history.unshift(action);
      if (this.history.length > 5) {
        this.history.pop();
      }
    }
  }
};
</script>

<style scoped>
.counter-container {
  max-width: 400px;
  margin: 0 auto;
  padding: 20px;
  text-align: center;
  font-family: Arial, sans-serif;
}

.counter-display {
  margin: 20px 0;
}

.count {
  font-size: 48px;
  font-weight: bold;
  color: #42b983;
}

.controls {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin: 20px 0;
}

button {
  padding: 10px 20px;
  font-size: 18px;
  cursor: pointer;
  background-color: #42b983;
  color: white;
  border: none;
  border-radius: 4px;
  transition: background-color 0.3s;
}

button:hover:not(:disabled) {
  background-color: #35a372;
}

button:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}

.history {
  margin-top: 30px;
}

.history ul {
  list-style: none;
  padding: 0;
}

.history li {
  padding: 5px;
  margin: 5px 0;
  background-color: #f0f0f0;
  border-radius: 4px;
}
</style>