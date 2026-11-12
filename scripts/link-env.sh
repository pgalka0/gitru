#!/usr/bin/env sh

link_env() {
  target="$1"

  if [ ! -f "$target" ]; then
    echo "Linking .env file to $target..."
    link .env "$target"
  else
    echo "$target already exists, skipping."
  fi
}

echo "Linking .env file..."

for path in apps/desktop/.env; do
  link_env "$path"
done

echo "Done linking .env file."
