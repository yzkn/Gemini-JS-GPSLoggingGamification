/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            // 必要に応じて寒色系のカスタムカラーを拡張できます
            colors: {
                slate: {
                    950: '#020617',
                }
            }
        },
    },
    plugins: [],
}