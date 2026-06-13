{
  description = "misskey-aloudy — A website that reads out Misskey's timeline";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_24
            pnpm
            git
          ];

          # Pinned application defaults. Override per-shell with:
          #   SITE_URL=https://example.com pnpm run build
          SITE_URL = "http://localhost:3000";

          # Prepend the corepack shims that ship with nodejs_24 so that the
          # `pnpm` resolved by corepack's `packageManager` pin in
          # package.json (pnpm@10.34.3) wins over the Nixpkgs `pnpm`
          # derivation (currently pnpm@11.x). The Nix store is read-only,
          # so `corepack enable` cannot symlink shims into <nodejs_24>/bin;
          # putting the shim directory on PATH directly is the
          # Nix-friendly equivalent and what `corepack enable` would do on a
          # writable filesystem.
          shellHook = ''
            export PATH="${pkgs.nodejs_24}/lib/node_modules/corepack/shims:$PATH"
            echo "misskey-aloudy dev shell"
            echo "Run 'pnpm install' to install dependencies"
            echo "SITE_URL=$SITE_URL"
            echo "pnpm: $(pnpm --version 2>/dev/null || echo 'not on PATH')"
          '';
        };
      }
    );
}
