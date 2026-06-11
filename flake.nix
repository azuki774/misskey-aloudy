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
            bun
            nodejs_24
            git
          ];

          # Pinned application defaults. Override per-shell with:
          #   SITE_URL=https://example.com bun run build
          SITE_URL = "http://localhost:3000";

          shellHook = ''
            echo "misskey-aloudy dev shell"
            echo "Run 'bun install' to install dependencies"
            echo "SITE_URL=$SITE_URL"
          '';
        };
      }
    );
}
